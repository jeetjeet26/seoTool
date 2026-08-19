import unittest

from modules.keyword_strategy import (
    assign_page,
    build_keyword_strategy,
    classify_intent,
    is_relevant_keyword,
    seed_phrases,
)


class KeywordStrategyTests(unittest.TestCase):
    def test_no_hard_coded_keywords_survive_without_location(self):
        phrases = seed_phrases("Long Beach, California")
        self.assertTrue(all("long beach" in phrase.lower() for phrase in phrases))

    def test_community_type_changes_seed_strategy(self):
        new_homes = seed_phrases(
            "Walnut, California",
            "The Terraces",
            "new_homes",
        )
        self.assertIn("new homes for sale Walnut", new_homes)
        self.assertFalse(any("apartments for rent" in item for item in new_homes))
        master_planned = seed_phrases(
            "Irvine, California",
            "",
            "master_planned",
        )
        self.assertIn("master planned communities Irvine", master_planned)

        dual_market = build_keyword_strategy(
            location="Walnut, California",
            target_url="https://example.com/",
            property_name="The Terraces at Walnut",
            vertical="new_homes",
            secondary_locations=["Los Angeles, California"],
            related=[
                {
                    "keyword": "new homes walnut creek ca",
                    "volume": 900,
                },
                {
                    "keyword": "new homes walnut creek",
                    "volume": 800,
                },
                {
                    "keyword": "walnut new homes",
                    "volume": 300,
                },
            ],
        )
        keywords = [item["keyword"] for item in dual_market]
        self.assertIn("new homes for sale walnut", keywords)
        self.assertIn("new homes for sale los angeles", keywords)
        self.assertIn("walnut new homes", keywords)
        self.assertNotIn("new homes walnut creek ca", keywords)
        self.assertNotIn("new homes walnut creek", keywords)

    def test_intent_classification(self):
        brand = {"alexan"}
        self.assertEqual(
            classify_intent("alexan west end reviews", brand), "navigational"
        )
        self.assertEqual(
            classify_intent("apartments for rent dallas", brand), "transactional"
        )
        self.assertEqual(
            classify_intent("what is a studio apartment", brand), "informational"
        )
        self.assertEqual(
            classify_intent("luxury apartments dallas", brand), "commercial"
        )
        self.assertEqual(
            classify_intent("new homes for sale walnut", brand, "new_homes"),
            "transactional",
        )
        self.assertEqual(
            classify_intent("new homes walnut", brand, "new_homes"), "commercial"
        )

    def test_housing_verticals_include_transactional_candidates(self):
        cases = (
            ("multifamily", "Dallas"),
            ("new_homes", "Walnut"),
            ("master_planned", "Irvine"),
            ("senior_living", "Phoenix"),
            ("luxury_living", "Miami"),
        )
        for vertical, location in cases:
            with self.subTest(vertical=vertical):
                results = build_keyword_strategy(
                    location=location,
                    target_url="https://example.com/",
                    vertical=vertical,
                )
                self.assertTrue(
                    any(item["intent"] == "transactional" for item in results)
                )

    def test_page_assignment_prefers_relevant_paths(self):
        pages = [
            "https://example.com/floor-plans/",
            "https://example.com/amenities/",
            "https://example.com/contact/",
        ]
        self.assertEqual(
            assign_page("2 bedroom apartments dallas", pages, "https://example.com/"),
            "https://example.com/floor-plans/",
        )
        self.assertEqual(
            assign_page("pet friendly apartments dallas", pages, "https://example.com/"),
            "https://example.com/amenities/",
        )
        self.assertEqual(
            assign_page("unrelated query", pages, "https://example.com/"),
            "https://example.com/",
        )

    def test_merges_sources_and_scores(self):
        rankings = [
            {
                "keyword": "apartments in long beach",
                "position": 8,
                "volume": 900,
                "cpc": 1.4,
                "difficulty": 35,
                "landing_page": "https://example.com/",
            }
        ]
        related = [
            {"keyword": "long beach lofts", "volume": 200, "cpc": 0.8, "difficulty": 20},
            # Duplicate of a ranking keyword must not double-count.
            {"keyword": "apartments in long beach", "volume": 900},
        ]
        results = build_keyword_strategy(
            location="Long Beach",
            target_url="https://example.com/",
            rankings=rankings,
            related=related,
            page_urls=["https://example.com/floor-plans/"],
        )

        keywords = [entry["keyword"] for entry in results]
        self.assertEqual(keywords.count("apartments in long beach"), 1)
        ranked = next(e for e in results if e["keyword"] == "apartments in long beach")
        self.assertEqual(ranked["source"], "ranking")
        self.assertEqual(ranked["assigned_page"], "https://example.com/")
        self.assertGreater(ranked["score"], 0)
        # Sorted by score descending.
        scores = [entry["score"] for entry in results]
        self.assertEqual(scores, sorted(scores, reverse=True))
        # Seeds are included and carry evidence.
        seeds = [entry for entry in results if entry["source"] == "seed"]
        self.assertTrue(seeds)
        self.assertTrue(all(entry["evidence"] for entry in results))

    def test_seed_keywords_use_semrush_metrics(self):
        results = build_keyword_strategy(
            location="Long Beach, California",
            target_url="https://example.com/",
            seed_metrics={
                "luxury apartments Long Beach": {
                    "volume": 390,
                    "kd": 47,
                }
            },
        )
        seed = next(
            entry
            for entry in results
            if entry["keyword"] == "luxury apartments long beach"
        )
        self.assertEqual(seed["volume"], 390)
        self.assertEqual(seed["difficulty"], 47)
        self.assertEqual(seed["evidence"]["semrush_report"], "phrase_this")

    def test_max_keywords_cap(self):
        related = [
            {"keyword": f"apartments for rent dallas {index}", "volume": index}
            for index in range(100)
        ]
        results = build_keyword_strategy(
            location="Dallas",
            target_url="https://example.com/",
            related=related,
            max_keywords=25,
        )
        self.assertEqual(len(results), 25)

    def test_filters_unrelated_related_keywords(self):
        self.assertFalse(
            is_relevant_keyword("park avenue", {"long", "beach"}, {"alexan"})
        )

    def test_filters_competitor_brands_from_every_source(self):
        results = build_keyword_strategy(
            location="Dallas",
            target_url="https://example.com/",
            rankings=[
                {
                    "keyword": "camden apartments dallas",
                    "volume": 500,
                    "position": 10,
                }
            ],
            related=[
                {
                    "keyword": "camden apartments for rent dallas",
                    "volume": 300,
                }
            ],
            competitor_terms=["camden"],
        )
        self.assertFalse(any("camden" in item["keyword"] for item in results))

    def test_approved_target_keeps_its_page_and_precedes_new_ideas(self):
        results = build_keyword_strategy(
            location="Dallas",
            target_url="https://example.com/",
            approved_targets=[
                {
                    "keyword": "apartments in dallas",
                    "canonical_url": "https://example.com/floor-plans/",
                    "role": "primary",
                    "metrics": {"volume": 1000, "difficulty": 40},
                }
            ],
            related=[
                {
                    "keyword": "luxury apartments dallas",
                    "volume": 5000,
                    "difficulty": 20,
                }
            ],
        )
        self.assertEqual(results[0]["source"], "approved")
        self.assertEqual(
            results[0]["assigned_page"],
            "https://example.com/floor-plans/",
        )
        self.assertTrue(
            is_relevant_keyword(
                "apartments for rent long beach",
                {"long", "beach"},
                {"alexan"},
            )
        )

    def test_excluded_phrase_overrides_an_old_approved_target(self):
        results = build_keyword_strategy(
            location="Hoover",
            target_url="https://ariseknoxsquare.com/",
            approved_targets=[
                {
                    "keyword": "arise denver apartments",
                    "canonical_url": "https://ariseknoxsquare.com/",
                    "role": "primary",
                }
            ],
            excluded_terms=["arise denver apartments"],
            vertical="senior_living",
        )
        self.assertFalse(any("denver" in item["keyword"] for item in results))


if __name__ == "__main__":
    unittest.main()
