import csv
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    import dotenv  # noqa: F401
except ImportError:
    dotenv_stub = types.ModuleType("dotenv")
    dotenv_stub.load_dotenv = lambda: None
    sys.modules["dotenv"] = dotenv_stub

from modules.audit_service import AuditService
from modules.crawler import CrawlError, Crawler
from modules.models import AuditStage, AuditStatus


def write_csv(path, rows):
    path = Path(path)
    fields = list(rows[0]) if rows else ["Address"]
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


class CrawlerTests(unittest.TestCase):
    def test_exit_zero_with_fatal_output_raises_custom_error(self):
        crawler = Crawler()
        with tempfile.TemporaryDirectory() as output:
            write_csv(Path(output) / "internal_all.csv", [{"Address": "https://example.com"}])
            completed = subprocess.CompletedProcess([], 0, "FATAL: license unavailable", "")
            with patch("modules.crawler.subprocess.run", return_value=completed):
                with self.assertRaisesRegex(CrawlError, "fatal error"):
                    crawler.run_crawl("https://example.com", output)

    def test_exit_zero_without_internal_export_raises_custom_error(self):
        crawler = Crawler()
        with tempfile.TemporaryDirectory() as output:
            unrelated = Path(output) / "keep.txt"
            unrelated.write_text("keep", encoding="utf-8")
            completed = subprocess.CompletedProcess([], 0, "Finished", "")
            with patch("modules.crawler.subprocess.run", return_value=completed):
                with self.assertRaisesRegex(CrawlError, "internal_all.csv"):
                    crawler.run_crawl("https://example.com", output)
            self.assertEqual(unrelated.read_text(encoding="utf-8"), "keep")


class FakeCrawler:
    def run_crawl(self, url, output_dir):
        write_csv(Path(output_dir) / "internal_all.csv", [{"Address": url}])
        write_csv(
            Path(output_dir) / "response_codes_client_error_(4xx).csv",
            [
                {
                    "Address": f"{url}/missing",
                    "Source": f"{url}/source",
                    "Status Code": "404",
                }
            ],
        )


class AuditServiceTests(unittest.TestCase):
    def test_service_uses_isolated_audit_directories(self):
        events = []
        service = AuditService(crawler=FakeCrawler(), progress_callback=events.append)
        with tempfile.TemporaryDirectory() as root:
            unrelated = Path(root) / "unrelated.txt"
            unrelated.write_text("safe", encoding="utf-8")
            with patch(
                "modules.audit_service.validate_public_audit_url",
                side_effect=lambda value: value,
            ):
                first = service.run_audit(
                    "audit-one", "https://one.example", "Austin", root
                )
                second = service.run_audit(
                    "audit-two", "https://two.example", "Dallas", root
                )

            self.assertNotEqual(first.work_dir, second.work_dir)
            self.assertTrue(Path(first.work_dir, "crawl", "internal_all.csv").is_file())
            self.assertTrue(Path(second.work_dir, "crawl", "internal_all.csv").is_file())
            self.assertEqual(unrelated.read_text(encoding="utf-8"), "safe")
            self.assertEqual(events[-1].stage, AuditStage.COMPLETE)
            self.assertEqual(events[-1].status, AuditStatus.COMPLETED)

    def test_filename_variants_and_required_exports_are_normalized(self):
        service = AuditService(crawler=FakeCrawler())
        with tempfile.TemporaryDirectory() as crawl:
            files = {
                "response_codes_client_error_(4xx).csv": {
                    "Address": "https://example.com/broken",
                    "Source": "https://example.com/",
                    "Status Code": "404",
                },
                "response_codes_redirection_(3xx).csv": {
                    "Address": "https://example.com/old",
                    "Redirect URI": "https://example.com/new",
                },
                "images_missing_alt_text.csv": {
                    "Address": "https://example.com/image.jpg",
                    "Source": "https://example.com/",
                },
                "images_missing_alt_attribute.csv": {
                    "Address": "https://example.com/no-alt.jpg",
                    "Source": "https://example.com/about",
                },
                "page_titles_missing.csv": {"Address": "https://example.com/title"},
                "meta_descriptions_missing.csv": {"Address": "https://example.com/meta"},
                "h1_missing.csv": {"Address": "https://example.com/h1"},
                "h1_multiple.csv": {
                    "Address": "https://example.com/multi",
                    "H1-1": "First",
                    "H1-2": "Second",
                },
                "canonicals_missing.csv": {"Address": "https://example.com/canonical"},
                "security_missing_x-frame-options_header.csv": {
                    "Address": "https://example.com/security"
                },
            }
            for filename, row in files.items():
                write_csv(Path(crawl) / filename, [row])

            findings = service.normalize_findings(crawl)
            issue_types = {finding.issue_type for finding in findings}
            self.assertEqual(
                issue_types,
                {
                    "client_error_4xx",
                    "redirection_3xx",
                    "missing_alt_text",
                    "missing_alt_attribute",
                    "missing_title",
                    "missing_meta_description",
                    "missing_h1",
                    "multiple_h1",
                    "missing_canonical",
                    "missing_x_frame_options",
                },
            )
            broken = next(item for item in findings if item.issue_type == "client_error_4xx")
            self.assertEqual(broken.page_url, "https://example.com/")
            self.assertEqual(broken.resource_url, "https://example.com/broken")
            self.assertEqual(len(broken.id), 64)
            self.assertEqual(
                broken.id,
                service.normalize_findings(crawl)[0].id,
            )


if __name__ == "__main__":
    unittest.main()
