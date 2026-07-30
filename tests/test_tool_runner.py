import unittest
from unittest.mock import patch

from worker.tool_repository import ToolRunItem, ToolRunJob
from worker.tools import ToolRunner, approved_metadata_by_url


class FakeToolRepository:
    def __init__(self, client=None, template_path=None):
        self.client = client or {
            "name": "Example Client",
            "website_url": "https://example.com",
            "notes": "",
            "intake": {},
        }
        self.template_path = template_path
        self.items: list[ToolRunItem] = []
        self.progress: list[tuple[str, int]] = []
        self.completed: dict | None = None
        self.failed: str | None = None

    def get_client_context(self, client_id):
        return self.client

    def get_input_artifact(self, run_id, kind):
        return self.template_path

    def record_progress(self, run_id, stage, progress, message="", payload=None):
        self.progress.append((stage, progress))

    def replace_items(self, run_id, items):
        self.items = list(items)
        return len(self.items)

    def complete_run(self, run_id, summary):
        self.completed = summary

    def fail_run(self, run_id, message):
        self.failed = message


class FakeArtifacts:
    def __init__(self, files=None):
        self.files = files or {}

    def download(self, object_path):
        return self.files[object_path]


class FakeSemrush:
    def get_organic_positions(self, domain, limit=100):
        return [
            {
                "keyword": "apartments dallas",
                "position": 6,
                "volume": 800,
                "cpc": 1.1,
                "difficulty": 30,
                "landing_page": "https://example.com/",
            }
        ]

    def get_competitors(self, domain, limit=10):
        return [{"domain": "rival.com", "common_keywords": 12}]

    def get_backlinks_overview(self, domain):
        return {"authority_score": 30}

    def get_keyword_ideas(self, phrase, limit=40):
        return [{"keyword": f"{phrase} ideas", "volume": 50}]

    def get_keyword_data(self, keywords):
        return {
            keyword: {"volume": 100, "kd": 25}
            for keyword in keywords
        }


class FakeGenerator:
    def generate_bulk_metadata(self, pages, mode="existing", client_context=None, on_progress=None):
        if on_progress:
            on_progress(len(pages), len(pages))
        return [
            {
                "url": page["url"],
                "mode": mode,
                "keywords": page.get("keywords") or [],
                "current_title": page.get("title", ""),
                "current_meta_description": page.get("meta_description", ""),
                "current_h1": page.get("h1", ""),
                "proposed_title": "Proposed title",
                "proposed_meta_description": "Proposed description",
                "proposed_h1": "Proposed H1",
                "proposed_content": "",
                "rationale": "Because.",
                "warnings": [],
            }
            for page in pages
        ]

    def generate_one_off(self, url, keywords, **kwargs):
        return {
            "url": url,
            "keywords": keywords,
            "proposed_title": "One-off title",
            "proposed_meta_description": "One-off description",
            "proposed_h1": "One-off H1",
            "proposed_content": "Rewritten copy",
            "rationale": "Because.",
            "warnings": [],
        }


def make_run(tool_type, options):
    return ToolRunJob(
        id="run-1",
        client_id="client-1",
        audit_id=None,
        tool_type=tool_type,
        name="Test run",
        options=options,
    )


def make_runner(repository, artifacts=None):
    return ToolRunner(
        repository,
        artifacts or FakeArtifacts(),
        semrush=FakeSemrush(),
        generator=FakeGenerator(),
    )


class ToolRunnerTests(unittest.TestCase):
    def test_keyword_research_produces_scored_items(self):
        repository = FakeToolRepository()
        runner = make_runner(repository)
        run = make_run(
            "keyword_research",
            {"target_url": "https://example.com/", "location": "Dallas"},
        )
        with patch("worker.tools.fetch_sitemap_urls", return_value=["https://example.com/"]):
            runner.process(run)

        self.assertIsNone(repository.failed)
        self.assertIsNotNone(repository.completed)
        self.assertGreater(repository.completed["keyword_count"], 0)
        self.assertEqual(repository.completed["ranked_count"], 1)
        self.assertTrue(all(item.item_type == "keyword" for item in repository.items))
        first = repository.items[0]
        self.assertIn("score", first.output)

    def test_bulk_metadata_from_template(self):
        template = (
            "url,seopress_titles_title,seopress_titles_desc\n"
            "https://example.com/,Old,Old desc\n"
        ).encode("utf-8")
        repository = FakeToolRepository(template_path="run-1/input/template.csv")
        artifacts = FakeArtifacts({"run-1/input/template.csv": template})
        runner = make_runner(repository, artifacts)
        run = make_run("bulk_metadata", {"mode": "existing", "keywords": ["apartments"]})
        runner.process(run)

        self.assertIsNone(repository.failed)
        self.assertEqual(repository.completed["page_count"], 1)
        item = repository.items[0]
        self.assertEqual(item.input["current_title"], "Old")
        self.assertEqual(item.output["proposed_title"], "Proposed title")

    def test_bulk_metadata_without_pages_fails(self):
        repository = FakeToolRepository()
        runner = make_runner(repository)
        run = make_run("bulk_metadata", {"target_url": "https://example.com/"})
        with patch("worker.tools.fetch_sitemap_urls", return_value=[]):
            runner.process(run)
        self.assertIsNotNone(repository.failed)

    def test_schema_generation_validates_facts(self):
        repository = FakeToolRepository()
        runner = make_runner(repository)
        run = make_run("schema_generation", {"facts": {"name": "X"}})
        runner.process(run)
        self.assertIsNone(repository.failed)
        self.assertFalse(repository.completed["valid"])
        self.assertTrue(repository.items[0].output["problems"])

    def test_schema_generation_valid_facts(self):
        repository = FakeToolRepository()
        runner = make_runner(repository)
        run = make_run(
            "schema_generation",
            {
                "facts": {
                    "name": "Alexan",
                    "url": "https://example.com/",
                    "street_address": "123 Main",
                    "city": "Dallas",
                    "region": "TX",
                    "postal_code": "75201",
                }
            },
        )
        runner.process(run)
        self.assertTrue(repository.completed["valid"])
        self.assertIn("script_tag", repository.items[0].output)

    def test_local_audit_seeds_checklist(self):
        repository = FakeToolRepository()
        runner = make_runner(repository)
        runner.process(make_run("local_audit", {}))
        self.assertEqual(repository.completed["check_count"], 25)
        platforms = {item.output["platform"] for item in repository.items}
        self.assertIn("Google Business Profile", platforms)
        self.assertIn("Apple Maps", platforms)

    def test_listing_optimization_keeps_original_copy(self):
        repository = FakeToolRepository()
        runner = make_runner(repository)
        run = make_run(
            "listing_optimization",
            {
                "listing_url": "https://listings.example.com/property",
                "keywords": ["apartments dallas"],
                "original_copy": "The original copy.",
            },
        )
        runner.process(run)
        item = repository.items[0]
        self.assertEqual(item.output["original_copy"], "The original copy.")
        self.assertEqual(item.output["proposed_copy"], "Rewritten copy")

    def test_unsupported_tool_type_fails_cleanly(self):
        repository = FakeToolRepository()
        runner = make_runner(repository)
        runner.process(make_run("unknown_tool", {}))
        self.assertIn("Unsupported tool type", repository.failed)


class ApprovedMetadataTests(unittest.TestCase):
    def test_only_approved_items_with_edits_preferred(self):
        items = [
            {
                "review_status": "approved",
                "stable_key": "https://example.com/",
                "output": {
                    "url": "https://example.com/",
                    "proposed_title": "Raw title",
                    "proposed_meta_description": "Raw description",
                },
                "edited_output": {"proposed_title": "Edited title"},
            },
            {
                "review_status": "unreviewed",
                "stable_key": "https://example.com/other/",
                "output": {"url": "https://example.com/other/", "proposed_title": "Skip"},
            },
        ]
        result = approved_metadata_by_url(items)
        self.assertEqual(list(result), ["https://example.com/"])
        self.assertEqual(result["https://example.com/"]["title"], "Edited title")
        self.assertEqual(
            result["https://example.com/"]["meta_description"], "Raw description"
        )


if __name__ == "__main__":
    unittest.main()
