import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker.insights import InsightRunner
from worker.repository import AuditJob


class FakeSemrush:
    def get_domain_overview(self, domain):
        return {
            "domain": domain,
            "organic_keywords": 20 if domain == "provided.com" else 10,
            "organic_traffic": 40 if domain == "provided.com" else 5,
        }

    def get_organic_positions(self, domain, limit=100):
        return [
            {
                "keyword": "apartments long beach",
                "position": 6,
                "volume": 700,
                "cpc": 1.2,
                "difficulty": 32,
                "landing_page": "https://example.com/",
            }
        ]

    def get_competitors(self, domain, limit=10):
        return [{"domain": "rival.com", "common_keywords": 12}]

    def get_backlinks_overview(self, domain):
        return {"authority_score": 28}

    def get_keyword_ideas(self, phrase, limit=40):
        return [{"keyword": f"{phrase} related", "volume": 90}]

    def get_keyword_data(self, keywords):
        return {
            keyword: {"volume": 120, "kd": 24}
            for keyword in keywords
        }


class FakeGenerator:
    def generate_bulk_metadata(self, pages, mode="existing", client_context=None, on_progress=None):
        return [
            {
                "url": page["url"],
                "keywords": page.get("keywords") or [],
                "current_title": page.get("title", ""),
                "current_meta_description": page.get("meta_description", ""),
                "current_h1": page.get("h1", ""),
                "proposed_title": "Proposed title",
                "proposed_meta_description": "Proposed description",
                "proposed_h1": "Proposed H1",
                "proposed_content": "",
                "warnings": [],
            }
            for page in pages
        ]

    def generate_alt_text(self, images, on_progress=None):
        return [
            {
                "image_url": image["image_url"],
                "page_url": image.get("page_url", ""),
                "proposed_alt_text": "Descriptive alt text",
                "warnings": [],
            }
            for image in images
        ]


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
    def _write_crawl(self, directory: Path, page_count: int) -> None:
        path = directory / "internal_all.csv"
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
            for index in range(page_count):
                writer.writerow(
                    {
                        "Address": f"https://example.com/page-{index}/",
                        "Status Code": "200",
                        "Content Type": "text/html",
                        "Title 1": f"Title {index}",
                        "H1-1": "Current H1",
                        "Meta Description 1": "Current description",
                    }
                )
        images = directory / "images_missing_alt_text.csv"
        with images.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=["Address", "Alt Text"])
            writer.writeheader()
            writer.writerow({"Address": "https://example.com/pool.jpg", "Alt Text": ""})

    def _run(
        self,
        page_count: int,
        page_limit: int = 1000,
        options: dict | None = None,
    ) -> dict:
        job = AuditJob(
            id="11111111-1111-4111-8111-111111111111",
            target_url="https://example.com/",
            target_city="Long Beach",
            target_region="California",
            page_limit=page_limit,
            run_performance=True,
            run_accessibility=True,
            options=options or {},
        )
        runner = InsightRunner(
            semrush=FakeSemrush(),
            pagespeed=FakePageSpeed(),
            generator=FakeGenerator(),
        )
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            self._write_crawl(directory, page_count)
            with (
                patch(
                    "modules.site_inventory.validate_public_audit_url",
                    side_effect=lambda value: value,
                ),
                patch(
                    "modules.site_inventory.fetch_sitemap_urls",
                    return_value=["https://example.com/page-0/"],
                ),
                patch(
                    "worker.insights.fetch_body_copy_for_pages",
                    side_effect=lambda urls: (
                        {
                            url: {
                                "url": url,
                                "body_text": "Current visible page copy.",
                                "body_word_count": 4,
                            }
                            for url in urls
                        },
                        [],
                    ),
                ),
            ):
                return runner.run(job, directory)

    def test_enriches_every_eligible_page_not_just_five(self):
        result = self._run(page_count=12)
        self.assertEqual(len(result["content_recommendations"]), 12)
        self.assertTrue(
            all(
                item["requires_human_review"]
                for item in result["content_recommendations"]
            )
        )
        self.assertEqual(result["enrichment_errors"], [])

    def test_page_limit_bounds_the_pipeline(self):
        result = self._run(page_count=12, page_limit=4)
        self.assertEqual(result["site_inventory"]["page_count"], 4)
        self.assertEqual(len(result["content_recommendations"]), 4)

    def test_keyword_strategy_replaces_hardcoded_phrases(self):
        result = self._run(page_count=2)
        keywords = [entry["keyword"] for entry in result["keyword_strategy"]]
        self.assertIn("apartments long beach", keywords)
        ranked = next(
            entry
            for entry in result["keyword_strategy"]
            if entry["keyword"] == "apartments long beach"
        )
        self.assertEqual(ranked["source"], "ranking")
        self.assertEqual(result["competitors"][0]["domain"], "rival.com")
        self.assertEqual(result["competitors"][0]["source"], "semrush")
        self.assertEqual(result["backlinks"]["authority_score"], 28)

    def test_provided_competitors_are_enriched_and_prioritized(self):
        result = self._run(
            page_count=2,
            options={"competitor_domains": ["provided.com"]},
        )
        competitor = result["competitors"][0]
        self.assertEqual(competitor["domain"], "provided.com")
        self.assertEqual(competitor["source"], "provided")
        self.assertEqual(competitor["organic_keywords"], 20)
        self.assertEqual(competitor["organic_traffic"], 40)

    def test_alt_text_and_page_experience(self):
        result = self._run(page_count=2)
        self.assertEqual(
            result["alt_text_recommendations"][0]["proposed_alt_text"],
            "Descriptive alt text",
        )
        self.assertEqual(result["page_experience"][0]["performance_score"], 91)


if __name__ == "__main__":
    unittest.main()
