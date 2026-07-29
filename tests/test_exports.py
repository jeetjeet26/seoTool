import csv
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

from modules.models import Finding, Severity
from worker.exports import generate_report_exports


class ExportTests(unittest.TestCase):
    def test_generates_csv_and_hyperlinked_excel_findings(self):
        finding = Finding(
            id="a" * 64,
            category="links",
            severity=Severity.HIGH,
            issue_type="client_error_4xx",
            page_url="https://example.com/",
            resource_url="https://example.com/missing",
            evidence='{"status_code":"404"}',
            recommendation="Update the link.",
            source_file="response_codes_client_error_(4xx).csv",
        )
        summary = {
            "finding_count": 1,
            "target_url": "https://example.com/",
            "content_recommendations": [
                {
                    "url": "https://example.com/",
                    "title": "Old",
                    "proposed_title": "New",
                    "requires_human_review": True,
                }
            ],
            "page_experience": [
                {
                    "url": "https://example.com/",
                    "performance_score": 90,
                    "accessibility_score": 95,
                }
            ],
        }

        with tempfile.TemporaryDirectory() as directory:
            paths = generate_report_exports(
                "audit-1", [finding], summary, Path(directory)
            )
            csv_path = next(path for path in paths if path.suffix == ".csv")
            xlsx_path = next(path for path in paths if path.suffix == ".xlsx")

            with csv_path.open(encoding="utf-8-sig") as stream:
                rows = list(csv.reader(stream))
            workbook = load_workbook(xlsx_path)

        self.assertEqual(rows[1][3], "https://example.com/")
        self.assertIn("Technical Findings", workbook.sheetnames)
        self.assertIn("Content Recommendations", workbook.sheetnames)
        self.assertIn("Performance & Accessibility", workbook.sheetnames)
        self.assertEqual(
            workbook["Technical Findings"]["D2"].hyperlink.target,
            "https://example.com/",
        )


if __name__ == "__main__":
    unittest.main()
