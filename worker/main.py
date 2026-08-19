"""Long-running, single-concurrency audit worker entrypoint."""

from __future__ import annotations

import sys

print("worker.main: module loading", file=sys.stderr, flush=True)

import csv
import logging
import shutil
import signal
import threading
import time
from collections import Counter
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from modules.audit_service import AuditService
from modules.site_inventory import (
    events_are_technical_only,
    fetch_sitemap_urls,
    is_event_page,
    should_scope_to_sitemap,
)
from modules.models import AuditStage, AuditStatus, ProgressEvent
from worker.artifacts import ArtifactStore, ToolArtifactStore
from worker.exports import generate_report_exports
from worker.insights import InsightRunner
from worker.repository import AuditJob, WorkerRepository
from worker.settings import WorkerSettings
from modules.google_places import GooglePlacesClient
from worker.tool_repository import ToolRepository
from worker.tools import ToolRunner

print("worker.main: imports complete", file=sys.stderr, flush=True)

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
    insight_runner = insights or InsightRunner(
        places=GooglePlacesClient(settings.google_maps_api_key)
    )
    audit_root = settings.work_root
    job_dir = audit_root / job.id

    try:
        with heartbeat(repository, job.id):
            sitemap_only = should_scope_to_sitemap(job.target_url, job.options)
            allowed_urls = (
                fetch_sitemap_urls(job.target_url) if sitemap_only else None
            )
            if sitemap_only and not allowed_urls:
                raise RuntimeError(
                    "Sitemap-only audit requested, but the sitemap contains no URLs."
                )
            import_paths = list(job.options.get("crawl_import_paths") or [])
            fallback_paths = list(job.options.get("crawl_fallback_paths") or [])
            used_local_import = bool(import_paths)
            if import_paths:
                artifacts.download_crawl_imports(
                    job.id,
                    import_paths,
                    job_dir / "crawl",
                )
                result = service.run_from_exports(
                    audit_id=job.id,
                    url=job.target_url,
                    city=job.location,
                    work_dir=audit_root,
                    page_limit=job.page_limit,
                    allowed_urls=allowed_urls,
                )
            else:
                result = service.run(
                    audit_id=job.id,
                    url=job.target_url,
                    city=job.location,
                    work_dir=audit_root,
                    finalize=False,
                    page_limit=job.page_limit,
                    allowed_urls=allowed_urls,
                )
                if fallback_paths and not _has_valid_html_export(
                    job_dir / "crawl" / "internal_all.csv"
                ):
                    shutil.rmtree(job_dir / "crawl", ignore_errors=True)
                    artifacts.download_crawl_imports(
                        job.id,
                        fallback_paths,
                        job_dir / "crawl",
                    )
                    result = service.run_from_exports(
                        audit_id=job.id,
                        url=job.target_url,
                        city=job.location,
                        work_dir=audit_root,
                        page_limit=job.page_limit,
                        allowed_urls=allowed_urls,
                    )
                    used_local_import = True
            repository.record_progress(
                ProgressEvent(
                    audit_id=job.id,
                    stage=AuditStage.ENRICHMENT,
                    status=AuditStatus.RUNNING,
                    progress=82,
                    message="Market, content, and technical enrichment started",
                )
            )
            insight_data = insight_runner.run(
                job,
                job_dir / "crawl",
                allowed_urls=allowed_urls,
            )
            if used_local_import:
                insight_data["crawl_coverage"] = {
                    **(insight_data.get("crawl_coverage") or {}),
                    "mode": "screaming_frog_import",
                    "screaming_frog": "complete",
                    "pages": int(
                        (insight_data.get("site_inventory") or {}).get("page_count")
                        or 0
                    ),
                }
            valid_pages = int(
                (insight_data.get("site_inventory") or {}).get("page_count") or 0
            )
            semrush_findings = insight_data.pop("_semrush_findings", [])
            if valid_pages <= 0 and not semrush_findings:
                raise RuntimeError(
                    "Crawl blocked or incomplete: neither the page fallback nor "
                    "Semrush Site Audit returned usable evidence."
                )
            crawler_findings = (
                result.findings
                if (insight_data.get("crawl_coverage") or {}).get(
                    "mode", "screaming_frog"
                )
                in {"screaming_frog", "screaming_frog_import"}
                else []
            )
            if allowed_urls is not None:
                crawler_findings = _scope_findings(crawler_findings, allowed_urls)
                semrush_findings = _scope_findings(semrush_findings, allowed_urls)
            combined_findings = _deduplicate_findings(
                [*crawler_findings, *semrush_findings]
            )
            if events_are_technical_only(job.target_url, job.options):
                event_findings = [
                    finding
                    for finding in combined_findings
                    if is_event_page(finding.page_url)
                ]
                combined_findings = [
                    finding
                    for finding in combined_findings
                    if not is_event_page(finding.page_url)
                ]
                insight_data["event_backlog"] = _event_backlog_summary(
                    event_findings,
                    int(
                        (insight_data.get("event_backlog") or {}).get(
                            "page_count"
                        )
                        or 0
                    ),
                )
            normalization_gaps = _inventory_normalization_gaps(
                insight_data.get("site_inventory") or {},
                combined_findings,
            )
            insight_data["normalization_status"] = (
                "incomplete" if normalization_gaps else "complete"
            )
            if normalization_gaps:
                insight_data["enrichment_errors"].append(
                    {
                        "service": "finding_normalization",
                        "message": (
                            "Crawl evidence could not be converted into findings for: "
                            + ", ".join(normalization_gaps)
                            + ". Health scoring is unavailable for this run."
                        ),
                    }
                )
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
            finding_count = repository.upsert_findings(job.id, combined_findings)
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
                finding.severity.value for finding in combined_findings
            )
            category_counts = Counter(
                finding.category for finding in combined_findings
            )
            pages_scanned = valid_pages or int(
                (insight_data.get("semrush_site_audit") or {}).get("scoped_pages")
                or 0
            )
            score = (
                None
                if normalization_gaps
                else _health_score(severity_counts, pages_scanned)
            )
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
                combined_findings,
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


def _has_valid_html_export(path: Path) -> bool:
    if not path.is_file():
        return False
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            status = str(row.get("Status Code") or "").strip()
            content_type = str(row.get("Content Type") or "").lower()
            if status in {"", "200", "200.0"} and (
                not content_type or "html" in content_type
            ):
                return True
    return False


def _health_score(severity_counts: Counter, pages_scanned: int) -> int:
    weights = {"critical": 10, "high": 5, "medium": 2, "low": 0.5, "info": 0}
    penalty = sum(
        weights.get(severity, 1) * count
        for severity, count in severity_counts.items()
    )
    scale = max(1, pages_scanned / 10)
    score = max(0, min(100, round(100 - penalty / scale)))
    return min(99, score) if penalty > 0 else score


def _inventory_normalization_gaps(
    inventory: dict,
    findings,
) -> list[str]:
    expected = {
        "missing_title": int(inventory.get("missing_title_count") or 0),
        "missing_meta_description": int(
            inventory.get("missing_description_count") or 0
        ),
        "missing_h1": int(inventory.get("missing_h1_count") or 0),
        "duplicate_title": int(inventory.get("duplicate_title_count") or 0),
        "duplicate_meta_description": int(
            inventory.get("duplicate_description_count") or 0
        ),
    }
    actual_types = {finding.issue_type for finding in findings}
    return [
        issue_type
        for issue_type, count in expected.items()
        if count > 0 and issue_type not in actual_types
    ]


def _event_backlog_summary(findings, page_count: int) -> dict:
    issue_counts = Counter(finding.issue_type for finding in findings)
    severity_counts = Counter(finding.severity.value for finding in findings)
    affected_urls = sorted({finding.page_url for finding in findings})
    return {
        "treatment": "technical_only",
        "page_count": page_count,
        "finding_count": len(findings),
        "issue_counts": dict(issue_counts.most_common()),
        "severity_counts": dict(severity_counts),
        "sample_urls": affected_urls[:5],
    }


def _scope_findings(findings, allowed_urls):
    allowed = {_url_key(url) for url in allowed_urls}
    return [
        finding
        for finding in findings
        if _url_key(finding.page_url) in allowed
    ]


def _url_key(url: str) -> str:
    parts = urlsplit(str(url).strip())
    path = parts.path.rstrip("/") or "/"
    base = f"{parts.scheme.lower()}://{parts.netloc.lower()}{path}"
    return f"{base}?{parts.query}" if parts.query else base


def _deduplicate_findings(findings):
    seen = set()
    result = []
    for finding in findings:
        key = (
            finding.issue_type,
            finding.page_url.rstrip("/"),
            finding.resource_url.rstrip("/"),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(finding)
    return result


if __name__ == "__main__":
    run()
