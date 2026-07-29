import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from modules.models import AuditResult, AuditStatus, Finding, Severity
from worker.main import process_job
from worker.repository import AuditJob


class FakeRepository:
    def __init__(self):
        self.completed = None
        self.failed = None
        self.snapshots = []
        self.events = []

    def heartbeat(self, audit_id):
        return True

    def record_progress(self, event):
        self.events.append(event)

    def upsert_findings(self, audit_id, findings):
        return len(list(findings))

    def record_snapshot(self, audit_id, snapshot):
        self.snapshots.append((audit_id, snapshot))

    def complete_job(self, audit_id, summary):
        self.completed = (audit_id, summary)

    def fail_job(self, audit_id, message):
        self.failed = (audit_id, message)


class FakeArtifacts:
    def upload_crawl_exports(self, audit_id, crawl_dir):
        return [f"{audit_id}/crawl-export/internal_all.csv"]

    def upload_file(self, audit_id, path, kind):
        return f"{audit_id}/{kind}/{Path(path).name}"


class FakeAuditService:
    def __init__(self, progress_callback):
        self.progress_callback = progress_callback

    def run(self, audit_id, url, city, work_dir, finalize=True):
        crawl_dir = Path(work_dir) / audit_id / "crawl"
        crawl_dir.mkdir(parents=True)
        (crawl_dir / "internal_all.csv").write_text("Address\n" + url)
        return AuditResult(
            audit_id=audit_id,
            status=AuditStatus.COMPLETED,
            work_dir=str(crawl_dir.parent),
            findings=[
                Finding(
                    id="a" * 64,
                    category="metadata",
                    severity=Severity.MEDIUM,
                    issue_type="missing_meta_description",
                    page_url=url,
                    resource_url="",
                    evidence='{"issue":"missing_meta_description"}',
                    recommendation="Add a useful meta description.",
                    source_file="meta_description_missing.csv",
                )
            ],
        )


class FakeInsights:
    def run(self, job, crawl_dir):
        return {
            "semrush": {"organic_keywords": 12},
            "keyword_metrics": {},
            "content_recommendations": [],
            "page_experience": [],
            "enrichment_errors": [],
        }


class WorkerProcessingTests(unittest.TestCase):
    def test_process_job_persists_summary_and_cleans_work_dir(self):
        repository = FakeRepository()
        job = AuditJob(
            id="11111111-1111-4111-8111-111111111111",
            target_url="https://example.com/",
            target_city="Long Beach",
            target_region="California",
            page_limit=1000,
            run_performance=True,
            run_accessibility=True,
            options={},
        )

        with tempfile.TemporaryDirectory() as root:
            settings = SimpleNamespace(work_root=Path(root))
            with patch("worker.main.AuditService", FakeAuditService):
                process_job(
                    job,
                    settings,
                    repository,
                    FakeArtifacts(),
                    insights=FakeInsights(),
                )

            self.assertFalse((Path(root) / job.id).exists())

        self.assertIsNone(repository.failed)
        self.assertEqual(repository.completed[0], job.id)
        self.assertEqual(repository.completed[1]["finding_count"], 1)
        self.assertEqual(repository.completed[1]["severity_counts"], {"medium": 1})
        self.assertEqual(len(repository.snapshots), 1)


if __name__ == "__main__":
    unittest.main()
