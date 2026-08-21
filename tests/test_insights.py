import csv
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from modules.google_places import GeoLocation
from worker.insights import (
    InsightRunner,
    _content_generation_pages,
    _guard_excluded_recommendations,
    _limit_content_recommendations,
    _page_keyword_targets,
)
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

    def get_site_audit(self, target_url, preferred_project_id=""):
        return {
            "project_id": 1,
            "project_name": "Test project",
            "findings": [],
        }

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

    def generate_alt_text(
        self,
        images,
        on_progress=None,
        fair_housing_enabled=False,
    ):
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


class FakePlaces:
    enabled = True

    def select_competitors(
        self,
        *,
        property_address,
        fallback_location,
        competitor_names,
        radius_miles=75,
        limit=10,
    ):
        return (
            GeoLocation(
                latitude=34.032,
                longitude=-117.829,
                formatted_address=property_address,
                locality="Walnut",
                region="CA",
                place_id="subject",
            ),
            [
                {
                    "name": name.split(" by ", 1)[0],
                    "builder": name.split(" by ", 1)[1] if " by " in name else "",
                    "location": "Hacienda Heights, CA",
                    "address": "1155 Glenelder Ave, Hacienda Heights, CA",
                    "url": "https://www.lennar.com/sella",
                    "place_id": f"place-{index}",
                    "latitude": 33.99,
                    "longitude": -117.97,
                    "distance_miles": 9.2,
                    "score": 82,
                    "source": "google_places",
                    "resolution_status": "verified",
                }
                for index, name in enumerate(competitor_names[:limit])
            ],
        )


class InsightRunnerTests(unittest.TestCase):
    def test_excluded_brand_is_blocked_from_generated_copy(self):
        guarded = _guard_excluded_recommendations(
            [
                {
                    "current_title": "Amenities | Arise Knox Square",
                    "current_meta_description": "",
                    "current_h1": "Amenities",
                    "proposed_title": "Arise Denver Apartments Amenities",
                    "proposed_meta_description": "Explore Hoover senior living.",
                    "proposed_h1": "Amenities",
                    "proposed_content": "Current content.",
                    "warnings": [],
                }
            ],
            ["Arise Denver Apartments"],
        )
        self.assertEqual(
            guarded[0]["proposed_title"],
            "Amenities | Arise Knox Square",
        )
        self.assertEqual(guarded[0]["proposed_content"], "")
        self.assertIn("Excluded term blocked", guarded[0]["warnings"][0])

    def test_sitemap_scoped_rewrites_exclude_calendar_event_pages(self):
        pages = [
            SimpleNamespace(url="https://ariseknoxsquare.com/amenities/"),
            SimpleNamespace(url="https://ariseknoxsquare.com/events/"),
            SimpleNamespace(
                url="https://ariseknoxsquare.com/event/open-house/"
            ),
        ]

        selected = _content_generation_pages(pages, sitemap_only=True)

        self.assertEqual(
            [page.url for page in selected],
            [
                "https://ariseknoxsquare.com/amenities/",
                "https://ariseknoxsquare.com/event/open-house/",
            ],
        )

    def test_event_pages_keep_on_page_copy_recommendations(self):
        limited = _limit_content_recommendations(
            [
                {
                    "url": "https://example.com/amenities/",
                    "proposed_content": "Core amenities copy.",
                    "current_body_word_count": 80,
                },
                {
                    "url": "https://example.com/event/open-house/",
                    "proposed_content": "Join the community open house.",
                    "current_body_text": "Open house details.",
                    "current_body_word_count": 12,
                },
            ],
            "full_client",
        )
        by_url = {item["url"]: item for item in limited}
        self.assertEqual(
            by_url["https://example.com/event/open-house/"]["proposed_content"],
            "Join the community open house.",
        )
        self.assertEqual(
            by_url["https://example.com/amenities/"]["proposed_content"],
            "Core amenities copy.",
        )

    def test_event_pages_do_not_inherit_generic_keywords(self):
        pages = [
            SimpleNamespace(
                url="https://example.com/",
                title="Apartments in Knoxville",
                h1="Home",
            ),
            SimpleNamespace(
                url="https://example.com/event/tailgates-tours/",
                title="Tailgates and Tours",
                h1="Tailgates",
            ),
        ]
        keywords = [
            {"keyword": "apartments knoxville", "source": "seed", "score": 80},
            {"keyword": "luxury apartments", "source": "related", "score": 70},
        ]

        targets = _page_keyword_targets(keywords, pages, pages[0].url)

        self.assertEqual(targets[pages[1].url][0], "tailgates tours")
        self.assertNotIn("apartments knoxville", targets[pages[1].url])
        self.assertNotIn("luxury apartments", targets[pages[1].url])

    def test_keyword_targets_vary_by_page_and_preserve_approved_assignments(self):
        pages = [
            SimpleNamespace(
                url="https://example.com/",
                title="New homes in Walnut",
                h1="The Terraces",
            ),
            SimpleNamespace(
                url="https://example.com/neighborhoods/felice/",
                title="Felice Townhomes",
                h1="Felice",
            ),
            SimpleNamespace(
                url="https://example.com/amenities/",
                title="Community Amenities",
                h1="Amenities",
            ),
        ]
        keywords = [
            {
                "keyword": "felice townhomes walnut",
                "source": "approved",
                "assigned_page": pages[1].url,
                "score": 100,
            },
            {"keyword": "new homes walnut", "source": "seed", "score": 80},
            {"keyword": "homes for sale walnut", "source": "seed", "score": 70},
            {"keyword": "townhomes for sale walnut", "source": "related", "score": 60},
            {"keyword": "new construction walnut", "source": "related", "score": 50},
            {"keyword": "home builders walnut", "source": "related", "score": 40},
        ]

        targets = _page_keyword_targets(keywords, pages, pages[0].url)

        self.assertEqual(targets[pages[1].url][0], "felice townhomes walnut")
        self.assertEqual(len({tuple(value) for value in targets.values()}), 3)

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
        client_intake: dict | None = None,
        places=None,
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
            client_intake=client_intake or {},
        )
        runner = InsightRunner(
            semrush=FakeSemrush(),
            pagespeed=FakePageSpeed(),
            generator=FakeGenerator(),
            places=places,
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
                    side_effect=lambda urls, stored_copy=None: (
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

    def test_event_detail_pages_are_fetched_and_keep_copy(self):
        fetched_urls: list[str] = []

        class EventCopyGenerator(FakeGenerator):
            def generate_bulk_metadata(
                self,
                pages,
                mode="existing",
                client_context=None,
                on_progress=None,
            ):
                return [
                    {
                        **item,
                        "proposed_content": "Join the open house this Saturday.",
                        "current_body_text": page.get("body_text", ""),
                        "content_action": "new_block",
                    }
                    for item, page in zip(
                        super().generate_bulk_metadata(
                            pages,
                            mode=mode,
                            client_context=client_context,
                            on_progress=on_progress,
                        ),
                        pages,
                    )
                ]

        job = AuditJob(
            id="11111111-1111-4111-8111-111111111111",
            target_url="https://example.com/",
            target_city="Knoxville",
            target_region="Tennessee",
            page_limit=20,
            run_performance=False,
            run_accessibility=False,
            options={"event_page_treatment": "technical_only"},
        )
        runner = InsightRunner(
            semrush=FakeSemrush(),
            pagespeed=FakePageSpeed(),
            generator=EventCopyGenerator(),
        )
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
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
                for url, title in (
                    ("https://example.com/", "Home"),
                    ("https://example.com/amenities/", "Amenities"),
                    ("https://example.com/event/open-house/", "Open House"),
                    ("https://example.com/events/", "Events"),
                ):
                    writer.writerow(
                        {
                            "Address": url,
                            "Status Code": "200",
                            "Content Type": "text/html",
                            "Title 1": title,
                            "H1-1": title,
                            "Meta Description 1": "",
                        }
                    )
            with (
                patch(
                    "modules.site_inventory.validate_public_audit_url",
                    side_effect=lambda value: value,
                ),
                patch(
                    "modules.site_inventory.fetch_sitemap_urls",
                    return_value=[
                        "https://example.com/",
                        "https://example.com/amenities/",
                        "https://example.com/event/open-house/",
                    ],
                ),
                patch(
                    "worker.insights.fetch_body_copy_for_pages",
                    side_effect=lambda urls, stored_copy=None: (
                        fetched_urls.extend(urls)
                        or (
                            {
                                url: {
                                    "url": url,
                                    "body_text": "Saturday open house in the clubhouse.",
                                    "body_word_count": 7,
                                }
                                for url in urls
                            },
                            [],
                        )
                    ),
                ),
            ):
                result = runner.run(job, directory)

        self.assertIn("https://example.com/event/open-house/", fetched_urls)
        self.assertNotIn("https://example.com/events/", fetched_urls)
        by_url = {item["url"]: item for item in result["content_recommendations"]}
        self.assertIn("https://example.com/event/open-house/", by_url)
        self.assertEqual(
            by_url["https://example.com/event/open-house/"]["proposed_content"],
            "Join the open house this Saturday.",
        )
        self.assertNotIn("https://example.com/events/", by_url)
        self.assertEqual(result["crawl_coverage"]["event_pages"], 1)
        self.assertEqual(result["event_page_treatment"], "event_details")

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

    def test_sitemap_scope_limits_all_page_driven_enrichment(self):
        result = self._run(
            page_count=12,
            options={"sitemap_only": True},
        )
        self.assertEqual(result["site_inventory"]["page_count"], 1)
        self.assertEqual(len(result["content_recommendations"]), 1)
        self.assertEqual(result["crawl_coverage"]["scope"], "sitemap_only")

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
        self.assertEqual(len(result["competitors"]), 1)

    def test_google_places_selects_communities_and_records_origin(self):
        result = self._run(
            page_count=2,
            client_intake={
                "nap": {
                    "address": "22045 Garibaldi Dr, Walnut, CA 91789",
                },
                "competitors": "Sella by Lennar\nBrookfield Walnut",
            },
            places=FakePlaces(),
        )
        self.assertEqual(
            [item["name"] for item in result["competitor_communities"]],
            ["Sella", "Brookfield Walnut"],
        )
        self.assertEqual(result["competitors"], [])
        self.assertEqual(result["property_context"]["locality"], "Walnut")
        self.assertEqual(result["property_context"]["region"], "CA")
        self.assertEqual(result["property_context"]["latitude"], 34.032)

    def test_audit_form_competitor_names_use_google_places(self):
        result = self._run(
            page_count=2,
            options={
                "competitor_names": [
                    "Sella by Lennar",
                    "Brookfield Walnut",
                ],
            },
            client_intake={
                "nap": {
                    "address": "22045 Garibaldi Dr, Walnut, CA 91789",
                },
            },
            places=FakePlaces(),
        )
        self.assertEqual(
            [item["name"] for item in result["competitor_communities"]],
            ["Sella", "Brookfield Walnut"],
        )
        self.assertEqual(result["competitors"], [])

    def test_audit_community_type_overrides_multifamily_default(self):
        result = self._run(
            page_count=2,
            options={
                "community_type": "new_homes",
                "secondary_market": "Los Angeles",
            },
        )
        self.assertEqual(result["property_context"]["vertical"], "new_homes")
        self.assertEqual(
            result["property_context"]["secondary_market"],
            "Los Angeles",
        )
        keywords = [item["keyword"] for item in result["keyword_strategy"]]
        self.assertTrue(any("homes for sale" in keyword for keyword in keywords))
        self.assertTrue(any("los angeles" in keyword for keyword in keywords))
        self.assertFalse(any("apartments for rent" in keyword for keyword in keywords))

    def test_alt_text_and_page_experience(self):
        result = self._run(page_count=2)
        self.assertEqual(
            result["alt_text_recommendations"][0]["proposed_alt_text"],
            "Descriptive alt text",
        )
        self.assertEqual(result["page_experience"][0]["performance_score"], 91)


if __name__ == "__main__":
    unittest.main()
