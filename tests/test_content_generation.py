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
                    "title": f"Senior living apartments in Hoover AL {index + 1}",
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
        self.assertEqual(
            results[0]["proposed_title"],
            "Senior living apartments in Hoover AL 1",
        )
        self.assertIn("title_under_50", results[0]["warnings"])

    def test_failed_chunk_marks_items_and_run_continues(self):
        bad = "not json at all"
        agent = FakeAgent(responses=[bad, bad])  # both attempts for chunk 1 fail
        generator = ContentGenerator(agent=agent, chunk_size=1)
        results = generator.generate_bulk_metadata(
            [{"url": "https://example.com/a/"}, {"url": "https://example.com/b/"}]
        )
        self.assertEqual(results[0]["error"], "generation_failed")
        self.assertNotIn("error", results[1])
        self.assertTrue(results[1]["proposed_title"].startswith("Senior living apartments"))

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

    def test_event_pages_get_event_specific_writing_rules(self):
        agent = FakeAgent()
        generator = ContentGenerator(agent=agent)
        generator.generate_bulk_metadata(
            [
                {
                    "url": "https://example.com/event/open-house/",
                    "body_text": "Saturday tour of the clubhouse.",
                    "body_word_count": 5,
                }
            ]
        )
        _system, user_prompt = agent.prompts[0]
        self.assertIn("unique event SEO", user_prompt)
        self.assertIn("Saturday tour of the clubhouse.", user_prompt)
        self.assertIn("visible body copy", user_prompt)

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

    def test_existing_copy_uses_only_a_light_paragraph_rewrite(self):
        current = (
            "Explore thoughtfully designed homes with flexible spaces, useful "
            "amenities, and convenient access to shops and parks."
        )
        proposed = current.replace("useful amenities", "resort-style amenities")
        response = json.dumps(
            [
                {
                    "index": 1,
                    "title": "New homes in Walnut - Example",
                    "meta_description": "D" * 140,
                    "h1": "Current H1",
                    "content": proposed,
                    "content_action": "rewrite_block",
                    "rationale": "Lightly improves keyword alignment.",
                }
            ]
        )
        result = ContentGenerator(agent=FakeAgent(responses=[response])).generate_bulk_metadata(
            [
                {
                    "url": "https://example.com/",
                    "title": "Current title",
                    "meta_description": "Current description",
                    "h1": "Current H1",
                    "body_text": f"{current} Additional page copy.",
                    "rewrite_block": current,
                    "body_word_count": 18,
                }
            ]
        )[0]
        self.assertEqual(result["content_action"], "rewrite_block")
        self.assertEqual(result["current_body_text"], current)
        self.assertEqual(result["proposed_content"], proposed)

    def test_large_robotic_rewrite_is_dropped(self):
        current = "This existing paragraph contains concise facts about the community and its available homes."
        response = json.dumps(
            [
                {
                    "index": 1,
                    "title": "New homes in Walnut - Example",
                    "meta_description": "D" * 140,
                    "h1": "Current H1",
                    "content": (
                        "Completely different marketing copy with many extra claims "
                        "and an expanded description that replaces every original idea."
                    ),
                    "content_action": "rewrite_block",
                    "rationale": "Rewrites the page.",
                }
            ]
        )
        result = ContentGenerator(agent=FakeAgent(responses=[response])).generate_bulk_metadata(
            [
                {
                    "url": "https://example.com/",
                    "title": "Current title",
                    "meta_description": "Current description",
                    "h1": "Current H1",
                    "body_text": current,
                    "rewrite_block": current,
                    "body_word_count": 13,
                }
            ]
        )[0]
        self.assertEqual(result["content_action"], "none")
        self.assertEqual(result["proposed_content"], "")
        self.assertIn("content_change_too_large", result["warnings"])

    def test_missing_copy_is_labeled_as_a_new_short_block(self):
        proposed = "Discover new homes in Walnut with flexible floor plans and convenient access to local destinations."
        response = json.dumps(
            [
                {
                    "index": 1,
                    "title": "New homes in Walnut - Example",
                    "meta_description": "D" * 140,
                    "h1": "New Homes in Walnut",
                    "content": proposed,
                    "content_action": "new_block",
                    "rationale": "Adds useful context.",
                }
            ]
        )
        result = ContentGenerator(agent=FakeAgent(responses=[response])).generate_bulk_metadata(
            [
                {
                    "url": "https://example.com/",
                    "title": "Current title",
                    "meta_description": "Current description",
                    "body_word_count": 0,
                }
            ]
        )[0]
        self.assertEqual(result["content_action"], "new_block")
        self.assertEqual(result["current_body_text"], "")
        self.assertIn("New paragraph block", result["rationale"])

    def test_oversized_new_block_is_trimmed_instead_of_discarded(self):
        proposed = " ".join(["Welcome"] * 50)
        response = json.dumps(
            [
                {
                    "index": 1,
                    "title": "New homes in Walnut - Example",
                    "meta_description": "D" * 140,
                    "h1": "New Homes in Walnut",
                    "content": proposed,
                    "content_action": "new_block",
                    "rationale": "Adds useful context.",
                }
            ]
        )
        result = ContentGenerator(agent=FakeAgent(responses=[response])).generate_bulk_metadata(
            [
                {
                    "url": "https://example.com/",
                    "title": "Current title",
                    "meta_description": "Current description",
                    "body_word_count": 0,
                }
            ]
        )[0]
        self.assertEqual(result["content_action"], "new_block")
        self.assertEqual(len(result["proposed_content"].split()), 35)
        self.assertIn("new_content_block_trimmed", result["warnings"])

    def test_short_titles_are_lengthened_toward_sixty_characters(self):
        response = json.dumps(
            [
                {
                    "index": 1,
                    "title": "News - Senior Apartments Hoover",
                    "meta_description": "D" * 140,
                    "h1": "News",
                    "content": "",
                    "rationale": "Uses the page keyword.",
                }
            ]
        )
        result = ContentGenerator(agent=FakeAgent(responses=[response])).generate_bulk_metadata(
            [
                {
                    "url": "https://ariseknoxsquare.com/news/",
                    "title": "News",
                    "meta_description": "Current description",
                    "keywords": ["senior apartments hoover"],
                }
            ],
            client_context={
                "name": "Arise Knox Square",
                "location": "Hoover, Alabama",
            },
        )[0]
        self.assertGreaterEqual(len(result["proposed_title"]), 50)
        self.assertLessEqual(len(result["proposed_title"]), 60)

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
        self.assertIn("change no more than 3-7 words", user_prompt)
        self.assertIn("content_action", user_prompt)

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

    def test_unchanged_title_gets_a_distinct_p11_fallback(self):
        unchanged = json.dumps(
            [
                {
                    "index": 1,
                    "title": "Privacy Policy - The Terraces at Walnut",
                    "meta_description": "Learn how The Terraces at Walnut handles website privacy, personal information, and data practices. Review the complete privacy policy for details.",
                    "h1": "Privacy Policy",
                    "content": "",
                    "rationale": "Keeps the legal page clear.",
                }
            ]
        )
        result = ContentGenerator(
            agent=FakeAgent(responses=[unchanged, unchanged]),
        ).generate_bulk_metadata(
            [
                {
                    "url": "https://terracesatwalnut.com/privacy-policy/",
                    "title": "Privacy Policy - The Terraces at Walnut",
                    "meta_description": "Current privacy description.",
                    "h1": "Privacy Policy",
                }
            ]
        )[0]
        self.assertEqual(
            result["proposed_title"],
            "The Terraces at Walnut - Privacy Policy",
        )

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
        self.assertIn("title_under_50", validate_metadata("ok", "d" * 140))
        self.assertEqual(
            validate_metadata(
                "Senior apartments in Hoover AL - Arise Knox Square",
                "d" * 140,
            ),
            [],
        )


if __name__ == "__main__":
    unittest.main()
