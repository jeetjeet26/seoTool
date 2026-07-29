import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker.insights import InsightRunner
from worker.repository import AuditJob


class FakeSemrush:
    def get_domain_overview(self, domain):
        return {"domain": domain, "organic_keywords": 10}

    def get_keyword_data(self, keywords):
        return {keyword: {"volume": 100, "kd": 30} for keyword in keywords}


class FakeAgent:
    def optimize_metadata(self, page):
        return {"title": "Proposed title", "meta_description": "Proposed description"}

    def optimize_onpage(self, page):
        return {"h1": "Proposed H1", "content": "Proposed introduction"}


class FakePageSpeed:
    def analyze_url(self, url):
        return {
            "url": url,
            "performance_score": 91,
            "accessibility_score": 96,
            "metrics": {},
            "accessibility_issues": [],
        }


class InsightRunnerTests(unittest.TestCase):
    def test_builds_market_content_and_page_experience_insights(self):
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
        runner = InsightRunner(
            semrush=FakeSemrush(),
            agent=FakeAgent(),
            pagespeed=FakePageSpeed(),
        )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "internal_all.csv"
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(
                    stream,
                    fieldnames=[
                        "Address",
                        "Status Code",
                        "Content Type",
                        "Title 1",
                        "H1-1",
                        "Meta Description 1",
                    ],
                )
                writer.writeheader()
                writer.writerow(
                    {
                        "Address": "https://example.com/",
                        "Status Code": "200",
                        "Content Type": "text/html",
                        "Title 1": "Current title",
                        "H1-1": "Current H1",
                        "Meta Description 1": "Current description",
                    }
                )
            with patch(
                "worker.insights.validate_public_audit_url",
                side_effect=lambda value: value,
            ):
                result = runner.run(job, Path(directory))

        self.assertEqual(result["semrush"]["organic_keywords"], 10)
        self.assertEqual(len(result["content_recommendations"]), 1)
        self.assertTrue(
            result["content_recommendations"][0]["requires_human_review"]
        )
        self.assertEqual(result["page_experience"][0]["performance_score"], 91)
        self.assertEqual(result["enrichment_errors"], [])


if __name__ == "__main__":
    unittest.main()
