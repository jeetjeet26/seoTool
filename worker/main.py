"""Long-running, single-concurrency audit worker entrypoint."""

from __future__ import annotations

import csv
import logging
import shutil
import signal
import threading
import time
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

from modules.audit_service import AuditService
from modules.models import AuditStage, AuditStatus, ProgressEvent
from worker.artifacts import ArtifactStore, ToolArtifactStore
from worker.exports import generate_report_exports
from worker.insights import InsightRunner
from worker.repository import AuditJob, WorkerRepository
from worker.settings import WorkerSettings
from worker.tool_repository import ToolRepository
from worker.tools import ToolRunner


LOGGER = logging.getLogger("seo_audit_worker")
STOP_EVENT = threading.Event()


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def _request_shutdown(signum, _frame) -> None:
    LOGGER.info("Shutdown requested", extra={"signal": signum})
    STOP_EVENT.set()


@contextmanager
def heartbeat(repository: WorkerRepository, audit_id: str, interval: int = 30):
    stop = threading.Event()

    def beat() -> None:
        while not stop.wait(interval):
            try:
                if not repository.heartbeat(audit_id):
                    LOGGER.warning("Audit heartbeat was rejected", extra={"audit_id": audit_id})
                    return
            except Exception:
                LOGGER.exception("Audit heartbeat failed", extra={"audit_id": audit_id})

    thread = threading.Thread(target=beat, daemon=True, name=f"heartbeat-{audit_id}")
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=interval + 1)


def process_job(
    job: AuditJob,
    settings: WorkerSettings,
    repository: WorkerRepository,
    artifacts: ArtifactStore,
    insights: InsightRunner | None = None,
) -> None:
    LOGGER.info("Processing audit", extra={"audit_id": job.id, "url": job.target_url})
    service = AuditService(progress_callback=repository.record_progress)
    insight_runner = insights or InsightRunner()
    audit_root = settings.work_root
    job_dir = audit_root / job.id

    try:
        with heartbeat(repository, job.id):
            result = service.run(
                audit_id=job.id,
                url=job.target_url,
                city=job.location,
                work_dir=audit_root,
                finalize=False,
            )
            repository.record_progress(
                ProgressEvent(
                    audit_id=job.id,
                    stage=AuditStage.ENRICHMENT,
                    status=AuditStatus.RUNNING,
                    progress=82,
                    message="Market, content, performance, and accessibility analysis started",
                )
            )
            insight_data = insight_runner.run(job, job_dir / "crawl")
            repository.record_progress(
                ProgressEvent(
                    audit_id=job.id,
                    stage=AuditStage.ENRICHMENT,
                    status=AuditStatus.COMPLETED,
                    progress=90,
                    message="Audit enrichment completed",
                    metadata={
                        "error_count": len(
                            insight_data.get("enrichment_errors", [])
                        )
                    },
                )
            )
            finding_count = repository.upsert_findings(job.id, result.findings)
            repository.record_progress(
                ProgressEvent(
                    audit_id=job.id,
                    stage=AuditStage.EXPORT,
                    status=AuditStatus.RUNNING,
                    progress=94,
                    message="Uploading crawl exports",
                )
            )

            severity_counts = Counter(
                finding.severity.value for finding in result.findings
            )
            category_counts = Counter(finding.category for finding in result.findings)
            pages_scanned = _count_csv_rows(job_dir / "crawl" / "internal_all.csv")
            score = _health_score(severity_counts, pages_scanned)
            summary = {
                "finding_count": finding_count,
                "pages_scanned": pages_scanned,
                "score": score,
                "severity_counts": dict(severity_counts),
                "category_counts": dict(category_counts),
                "target_url": job.target_url,
                "target_location": job.location,
                "page_limit": job.page_limit,
                "performance_requested": job.run_performance,
                "accessibility_requested": job.run_accessibility,
                **insight_data,
            }
            report_paths = generate_report_exports(
                job.id,
                result.findings,
                summary,
                job_dir / "reports",
            )
            uploaded = artifacts.upload_crawl_exports(job.id, job_dir / "crawl")
            for report_path in report_paths:
                uploaded.append(
                    artifacts.upload_file(job.id, report_path, "report-export")
                )
            summary["artifact_count"] = len(uploaded)
            repository.record_snapshot(job.id, summary)
            repository.record_progress(
                ProgressEvent(
                    audit_id=job.id,
                    stage=AuditStage.COMPLETE,
                    status=AuditStatus.COMPLETED,
                    progress=100,
                    message=f"Audit completed with {finding_count} findings",
                    metadata={"finding_count": finding_count},
                )
            )
            repository.complete_job(job.id, summary)
            LOGGER.info(
                "Audit completed",
                extra={"audit_id": job.id, "finding_count": finding_count},
            )
    except Exception as exc:
        LOGGER.exception("Audit failed", extra={"audit_id": job.id})
        try:
            repository.fail_job(job.id, str(exc))
        except Exception:
            LOGGER.exception(
                "Unable to persist audit failure", extra={"audit_id": job.id}
            )
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def process_tool_run(
    run,
    tool_repository: ToolRepository,
    tool_runner: ToolRunner,
) -> None:
    LOGGER.info(
        "Processing tool run",
        extra={"run_id": run.id, "tool_type": run.tool_type},
    )
    with tool_heartbeat(tool_repository, run.id):
        tool_runner.process(run)


@contextmanager
def tool_heartbeat(repository: ToolRepository, run_id: str, interval: int = 30):
    stop = threading.Event()

    def beat() -> None:
        while not stop.wait(interval):
            try:
                if not repository.heartbeat(run_id):
                    LOGGER.warning(
                        "Tool heartbeat was rejected", extra={"run_id": run_id}
                    )
                    return
            except Exception:
                LOGGER.exception("Tool heartbeat failed", extra={"run_id": run_id})

    thread = threading.Thread(target=beat, daemon=True, name=f"tool-heartbeat-{run_id}")
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=interval + 1)


def run() -> None:
    _configure_logging()
    settings = WorkerSettings.from_env()
    settings.work_root.mkdir(parents=True, exist_ok=True)
    repository = WorkerRepository(settings.database_url, settings.worker_id)
    artifacts = ArtifactStore(
        supabase_url=settings.supabase_url,
        service_role_key=settings.supabase_service_role_key,
        repository=repository,
    )
    tool_repository = ToolRepository(settings.database_url, settings.worker_id)
    tool_artifacts = ToolArtifactStore(
        supabase_url=settings.supabase_url,
        service_role_key=settings.supabase_service_role_key,
        repository=tool_repository,
    )
    tool_runner = ToolRunner(tool_repository, tool_artifacts)

    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)
    LOGGER.info("Audit worker started", extra={"worker_id": settings.worker_id})

    while not STOP_EVENT.is_set():
        try:
            job = repository.claim_next_job()
            if job:
                process_job(job, settings, repository, artifacts)
                continue
            tool_run = tool_repository.claim_next_run()
            if tool_run:
                process_tool_run(tool_run, tool_repository, tool_runner)
                continue
        except Exception:
            LOGGER.exception("Worker polling failed")
        STOP_EVENT.wait(settings.poll_seconds)

    LOGGER.info("Audit worker stopped")


def _count_csv_rows(path: Path) -> int:
    if not path.is_file():
        return 0
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        return sum(1 for _ in csv.DictReader(stream))


def _health_score(severity_counts: Counter, pages_scanned: int) -> int:
    weights = {"critical": 10, "high": 5, "medium": 2, "low": 0.5, "info": 0}
    penalty = sum(
        weights.get(severity, 1) * count
        for severity, count in severity_counts.items()
    )
    scale = max(1, pages_scanned / 10)
    return max(0, min(100, round(100 - penalty / scale)))


if __name__ == "__main__":
    run()
