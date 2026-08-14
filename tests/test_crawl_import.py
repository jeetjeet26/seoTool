import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from modules.audit_service import AuditService
from worker.artifacts import ArtifactStore, ArtifactUploadError


class FakeStorage:
    def __init__(self, files):
        self.files = files

    def get_object(self, bucket, object_path):
        return self.files[object_path]


class CrawlImportTests(unittest.TestCase):
    def test_downloads_and_extracts_csv_zip(self):
        archive_stream = io.BytesIO()
        with zipfile.ZipFile(archive_stream, "w") as archive:
            archive.writestr(
                "crawl/internal_all.csv",
                "Address,Status Code,Content Type\n"
                "https://example.com/,200,text/html\n",
            )
            archive.writestr(
                "crawl/page_titles_missing.csv",
                "Address\nhttps://example.com/\n",
            )
            archive.writestr("../ignored.txt", "ignored")
        audit_id = "11111111-1111-4111-8111-111111111111"
        object_path = f"{audit_id}/crawl-import/test.zip"
        store = ArtifactStore.__new__(ArtifactStore)
        store.storage = FakeStorage({object_path: archive_stream.getvalue()})

        with tempfile.TemporaryDirectory() as directory:
            written = store.download_crawl_imports(
                audit_id,
                [object_path],
                Path(directory),
            )
            self.assertTrue((Path(directory) / "internal_all.csv").is_file())
            self.assertTrue((Path(directory) / "page_titles_missing.csv").is_file())
            self.assertFalse((Path(directory).parent / "ignored.txt").exists())
        self.assertEqual(len(written), 2)

    def test_requires_internal_all_export(self):
        archive_stream = io.BytesIO()
        with zipfile.ZipFile(archive_stream, "w") as archive:
            archive.writestr("h1_missing.csv", "Address\n")
        audit_id = "11111111-1111-4111-8111-111111111111"
        object_path = f"{audit_id}/crawl-import/test.zip"
        store = ArtifactStore.__new__(ArtifactStore)
        store.storage = FakeStorage({object_path: archive_stream.getvalue()})
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ArtifactUploadError, "internal_all.csv"):
                store.download_crawl_imports(
                    audit_id,
                    [object_path],
                    Path(directory),
                )

    def test_normalizes_uploaded_exports_without_running_crawler(self):
        audit_id = "11111111-1111-4111-8111-111111111111"
        with tempfile.TemporaryDirectory() as directory:
            crawl_dir = Path(directory) / audit_id / "crawl"
            crawl_dir.mkdir(parents=True)
            (crawl_dir / "internal_all.csv").write_text(
                "Address,Status Code,Content Type\n"
                "https://example.com/,200,text/html\n",
                encoding="utf-8",
            )
            (crawl_dir / "h1_missing.csv").write_text(
                "Address\nhttps://example.com/\n",
                encoding="utf-8",
            )
            result = AuditService().run_from_exports(
                audit_id,
                "https://example.com/",
                "Dallas",
                directory,
            )
        missing_h1 = [
            finding
            for finding in result.findings
            if finding.issue_type == "missing_h1"
        ]
        self.assertEqual(len(missing_h1), 1)
        self.assertEqual(missing_h1[0].source_file, "h1_missing.csv")

    def test_internal_all_derives_baseline_findings_without_filtered_exports(self):
        audit_id = "11111111-1111-4111-8111-111111111111"
        with tempfile.TemporaryDirectory() as directory:
            crawl_dir = Path(directory) / audit_id / "crawl"
            crawl_dir.mkdir(parents=True)
            (crawl_dir / "internal_all.csv").write_text(
                "Address,Status Code,Status,Content Type,Indexability,"
                "Indexability Status,Title 1,Title 1 Length,"
                "Meta Description 1,Meta Description 1 Length,H1-1,H1-2,"
                "Canonical Link Element 1,Word Count\n"
                "https://example.com/a,200,OK,text/html,Indexable,,"
                "Repeated title,14,,,Heading,,,80\n"
                "https://example.com/b,200,OK,text/html,Indexable,,"
                "Repeated title,14,Description,11,,,https://example.com/b,300\n"
                "https://example.com/private,200,OK,text/html,Non-Indexable,"
                "noindex,Private,7,Private page,12,Private,,,100\n"
                "https://example.com/missing,404,Not Found,text/html,"
                "Non-Indexable,Client Error,,,,,,,,0\n",
                encoding="utf-8",
            )
            result = AuditService().run_from_exports(
                audit_id,
                "https://example.com/",
                "Dallas",
                directory,
                page_limit=4,
            )

        issue_types = [finding.issue_type for finding in result.findings]
        self.assertIn("missing_meta_description", issue_types)
        self.assertIn("missing_h1", issue_types)
        self.assertIn("duplicate_title", issue_types)
        self.assertNotIn("client_error_4xx", issue_types)
        self.assertNotIn("missing_canonical", issue_types)
        self.assertTrue(
            all(
                finding.source_file == "internal_all.csv"
                for finding in result.findings
            )
        )

    def test_filtered_export_prevents_internal_all_double_counting(self):
        audit_id = "11111111-1111-4111-8111-111111111111"
        with tempfile.TemporaryDirectory() as directory:
            crawl_dir = Path(directory) / audit_id / "crawl"
            crawl_dir.mkdir(parents=True)
            (crawl_dir / "internal_all.csv").write_text(
                "Address,Status Code,Content Type,Indexability,H1-1\n"
                "https://example.com/,200,text/html,Indexable,\n",
                encoding="utf-8",
            )
            (crawl_dir / "h1_missing.csv").write_text(
                "Address\nhttps://example.com/\n",
                encoding="utf-8",
            )
            findings = AuditService().normalize_findings(crawl_dir)

        missing_h1 = [
            finding for finding in findings if finding.issue_type == "missing_h1"
        ]
        self.assertEqual(len(missing_h1), 1)
        self.assertEqual(missing_h1[0].source_file, "h1_missing.csv")


if __name__ == "__main__":
    unittest.main()
