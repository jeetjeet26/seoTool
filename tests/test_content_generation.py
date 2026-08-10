import json
import unittest

from modules.content_generation import (
    ContentGenerator,
    validate_metadata,
)


class FakeAgent:
    FAIR_HOUSING_GUIDELINES = "FAIR HOUSING RULES"

    def __init__(self, responses=None):
        self.responses = list(responses or [])
        self.prompts = []

    def _get_completion(self, system_prompt, user_prompt, max_tokens=1000):
        self.prompts.append((system_prompt, user_prompt))
        if self.responses:
            return self.responses.pop(0)
        # Default: echo one entry per numbered page in the prompt.
        count = user_prompt.count(". URL:")
        return json.dumps(
            [
                {
                    "index": index + 1,
                    "title": f"Title {index + 1}",
                    "meta_description": "D" * 140,
                    "h1": f"H1 {index + 1}",
                    "content": "",
                    "rationale": "Targets the keyword.",
                }
                for index in range(count)
            ]
        )

    def generate_alt_text_batch(self, items, fair_housing_enabled=False):
        for item in items:
            item["suggested_fix"] = "Pool deck with lounge seating"
        return items


class ContentGenerationTests(unittest.TestCase):
    def test_chunked_generation_covers_all_pages(self):
        agent = FakeAgent()
        generator = ContentGenerator(agent=agent, chunk_size=2)
        pages = [{"url": f"https://example.com/p{index}/"} for index in range(5)]
        progress = []

        results = generator.generate_bulk_metadata(
            pages, mode="existing", on_progress=lambda done, total: progress.append(done)
        )

        self.assertEqual(len(results), 5)
        self.assertEqual(len(agent.prompts), 3)  # 2 + 2 + 1
        self.assertEqual(progress[-1], 5)
        self.assertEqual(results[0]["proposed_title"], "Title 1")
        self.assertEqual(results[0]["warnings"], [])

    def test_failed_chunk_marks_items_and_run_continues(self):
        bad = "not json at all"
        agent = FakeAgent(responses=[bad, bad])  # both attempts for chunk 1 fail
        generator = ContentGenerator(agent=agent, chunk_size=1)
        results = generator.generate_bulk_metadata(
            [{"url": "https://example.com/a/"}, {"url": "https://example.com/b/"}]
        )
        self.assertEqual(results[0]["error"], "generation_failed")
        self.assertNotIn("error", results[1])
        self.assertEqual(results[1]["proposed_title"], "Title 1")

    def test_fair_housing_guidelines_are_used_when_client_enables_them(self):
        agent = FakeAgent()
        generator = ContentGenerator(agent=agent)
        generator.generate_bulk_metadata(
            [{"url": "https://example.com/"}],
            client_context={"fair_housing_enabled": True},
        )
        system_prompt, user_prompt = agent.prompts[0]
        self.assertIn("FAIR HOUSING RULES", system_prompt)
        self.assertIn("Fair Housing safeguards", user_prompt)

    def test_fair_housing_guidelines_are_off_by_default(self):
        agent = FakeAgent()
        generator = ContentGenerator(agent=agent)
        generator.generate_bulk_metadata([{"url": "https://example.com/"}])
        system_prompt, user_prompt = agent.prompts[0]
        self.assertNotIn("FAIR HOUSING RULES", system_prompt)
        self.assertNotIn("Fair Housing safeguards", user_prompt)

    def test_client_context_facts_are_included(self):
        agent = FakeAgent()
        generator = ContentGenerator(agent=agent)
        generator.generate_bulk_metadata(
            [{"url": "https://example.com/"}],
            client_context={"name": "Alexan", "amenities": "Rooftop pool"},
        )
        _system, user_prompt = agent.prompts[0]
        self.assertIn("Rooftop pool", user_prompt)
        self.assertIn("Never invent amenities", user_prompt)

    def test_visible_body_copy_is_included_for_content_gap_analysis(self):
        agent = FakeAgent()
        generator = ContentGenerator(agent=agent)
        results = generator.generate_bulk_metadata(
            [
                {
                    "url": "https://example.com/services/",
                    "body_text": "Current service copy for prospective clients.",
                    "body_word_count": 6,
                }
            ]
        )
        _system, user_prompt = agent.prompts[0]
        self.assertIn("Current service copy for prospective clients.", user_prompt)
        self.assertIn("6 words", user_prompt)
        self.assertEqual(results[0]["current_body_word_count"], 6)

    def test_existing_mode_requires_title_and_description_rewrites_for_every_page(self):
        agent = FakeAgent()
        generator = ContentGenerator(agent=agent)
        generator.generate_bulk_metadata(
            [
                {
                    "url": "https://example.com/",
                    "title": "Current title",
                    "meta_description": "Current description",
                    "h1": "Current H1",
                }
            ]
        )
        _system, user_prompt = agent.prompts[0]
        self.assertIn("new proposed title", user_prompt)
        self.assertIn("new proposed meta description for every page", user_prompt)
        self.assertIn("otherwise return the current H1", user_prompt)

    def test_retries_when_existing_metadata_is_returned_unchanged(self):
        unchanged = json.dumps(
            [
                {
                    "index": 1,
                    "title": "Current title",
                    "meta_description": "Current description",
                    "h1": "Current H1",
                    "content": "",
                    "rationale": "No change.",
                }
            ]
        )
        corrected = json.dumps(
            [
                {
                    "index": 1,
                    "title": "New homes in Dallas - Example",
                    "meta_description": "Discover new homes in Dallas with modern plans and thoughtful community features. Explore available homes and schedule your visit today.",
                    "h1": "Current H1",
                    "content": "",
                    "rationale": "Targets the approved keyword.",
                }
            ]
        )
        agent = FakeAgent(responses=[unchanged, corrected])
        result = ContentGenerator(agent=agent).generate_bulk_metadata(
            [
                {
                    "url": "https://example.com/",
                    "title": "Current title",
                    "meta_description": "Current description",
                    "h1": "Current H1",
                }
            ]
        )[0]
        self.assertEqual(result["proposed_title"], "New homes in Dallas - Example")
        self.assertEqual(len(agent.prompts), 2)
        self.assertIn("VALIDATION FAILURE", agent.prompts[1][1])

    def test_one_off_returns_single_result(self):
        generator = ContentGenerator(agent=FakeAgent())
        result = generator.generate_one_off(
            url="https://example.com/floor-plans/",
            keywords=["2 bedroom apartments dallas"],
        )
        self.assertEqual(result["url"], "https://example.com/floor-plans/")
        self.assertTrue(result["proposed_title"])
        self.assertTrue(result["rationale"])

    def test_alt_text_generation(self):
        generator = ContentGenerator(agent=FakeAgent())
        results = generator.generate_alt_text(
            [
                {
                    "image_url": "https://example.com/pool.jpg",
                    "page_url": "https://example.com/amenities/",
                }
            ]
        )
        self.assertEqual(results[0]["proposed_alt_text"], "Pool deck with lounge seating")
        self.assertEqual(results[0]["warnings"], [])

    def test_metadata_validation_rules(self):
        self.assertIn("title_over_60", validate_metadata("x" * 61, "d" * 140))
        self.assertIn("description_over_155", validate_metadata("ok", "d" * 156))
        self.assertIn("description_under_130", validate_metadata("ok", "short"))
        self.assertEqual(validate_metadata("ok", "d" * 140), [])


if __name__ == "__main__":
    unittest.main()
