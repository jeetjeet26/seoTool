import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.site_inventory import (
    build_site_inventory,
    is_event_calendar_page,
    is_event_detail_page,
    is_event_page,
    load_crawled_pages,
    should_scope_to_sitemap,
)

FIELDS = [
    "Address",
    "Status Code",
    "Content Type",
    "Indexability",
    "Title 1",
    "Title 1 Length",
    "Meta Description 1",
    "Meta Description 1 Length",
    "H1-1",
    "H2-1",
    "Canonical Link Element 1",
    "Word Count",
]


def write_internal_csv(directory: Path, rows: list[dict]) -> None:
    path = directory / "internal_all.csv"
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def page_row(url: str, title: str = "Title", description: str = "Description") -> dict:
    return {
        "Address": url,
        "Status Code": "200",
        "Content Type": "text/html; charset=utf-8",
        "Indexability": "Indexable",
        "Title 1": title,
        "Title 1 Length": str(len(title)),
        "Meta Description 1": description,
        "Meta Description 1 Length": str(len(description)),
        "H1-1": "Heading",
        "H2-1": "Subheading",
        "Canonical Link Element 1": url,
        "Word Count": "250",
    }


class SiteInventoryTests(unittest.TestCase):
    def test_arise_uses_sitemap_scope_and_identifies_event_pages(self):
        self.assertTrue(
            should_scope_to_sitemap("https://ariseknoxsquare.com/", {})
        )
        self.assertTrue(is_event_page("https://ariseknoxsquare.com/events/"))
        self.assertTrue(
            is_event_page("https://ariseknoxsquare.com/event/open-house/")
        )
        self.assertTrue(
            is_event_calendar_page(
                "https://ariseknoxsquare.com/events/list/page/2/?tribe-bar-date=2025-11-21"
            )
        )
        self.assertTrue(
            is_event_detail_page("https://ariseknoxsquare.com/event/tailgates-tours/")
        )
        self.assertFalse(
            is_event_calendar_page("https://ariseknoxsquare.com/event/tailgates-tours/")
        )
        self.assertFalse(
            is_event_page("https://ariseknoxsquare.com/amenities/")
        )

    def test_loads_every_eligible_page_with_limit(self):
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            rows = [page_row(f"https://example.com/page-{index}/") for index in range(8)]
            rows.append(
                {**page_row("https://example.com/broken/"), "Status Code": "404"}
            )
            rows.append(
                {
                    **page_row("https://example.com/style.css"),
                    "Content Type": "text/css",
                }
            )
            write_internal_csv(directory, rows)

            with patch(
                "modules.site_inventory.validate_public_audit_url",
                side_effect=lambda value: value,
            ):
                pages = load_crawled_pages(directory / "internal_all.csv")
                limited = load_crawled_pages(
                    directory / "internal_all.csv", page_limit=3
                )

        self.assertEqual(len(pages), 8)
        self.assertEqual(len(limited), 3)
        self.assertEqual(pages[0].title, "Title")
        self.assertEqual(pages[0].word_count, 250)

    def test_reconciles_sitemap_and_crawl(self):
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            write_internal_csv(
                directory,
                [
                    page_row("https://example.com/"),
                    page_row("https://example.com/crawl-only/"),
                ],
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
                        "https://example.com/sitemap-only/",
                    ],
                ),
            ):
                inventory = build_site_inventory(
                    directory, "https://example.com/"
                )

        self.assertEqual(
            inventory.sitemap_only_urls, ["https://example.com/sitemap-only/"]
        )
        self.assertEqual(
            inventory.crawl_only_urls, ["https://example.com/crawl-only/"]
        )
        homepage = next(p for p in inventory.pages if p.url == "https://example.com/")
        self.assertTrue(homepage.in_sitemap)

    def test_sitemap_scope_excludes_automated_crawl_urls_before_page_limit(self):
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            write_internal_csv(
                directory,
                [
                    page_row("https://example.com/events/list/page/99/"),
                    page_row(
                        "https://example.com/amenities/?tribe_event_display=list"
                    ),
                    page_row("https://example.com/amenities/"),
                    page_row("https://example.com/contact/"),
                ],
            )
            with (
                patch(
                    "modules.site_inventory.validate_public_audit_url",
                    side_effect=lambda value: value,
                ),
                patch(
                    "modules.site_inventory.fetch_sitemap_urls",
                    return_value=[
                        "https://example.com/amenities/",
                        "https://example.com/contact/",
                    ],
                ),
            ):
                inventory = build_site_inventory(
                    directory,
                    "https://example.com/",
                    page_limit=1,
                    sitemap_only=True,
                )

        self.assertEqual(
            [page.url for page in inventory.pages],
            ["https://example.com/amenities/"],
        )
        self.assertEqual(inventory.crawl_only_urls, [])

    def test_flags_duplicates_and_missing_metadata(self):
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            write_internal_csv(
                directory,
                [
                    page_row("https://example.com/a/", title="Same"),
                    page_row("https://example.com/b/", title="Same"),
                    {**page_row("https://example.com/c/", title=""), "H1-1": ""},
                ],
            )
            with (
                patch(
                    "modules.site_inventory.validate_public_audit_url",
                    side_effect=lambda value: value,
                ),
                patch(
                    "modules.site_inventory.fetch_sitemap_urls",
                    return_value=[],
                ),
            ):
                inventory = build_site_inventory(directory, "https://example.com/")

        self.assertIn("Same", inventory.duplicate_titles)
        self.assertEqual(len(inventory.duplicate_titles["Same"]), 2)
        self.assertEqual(inventory.pages_missing_title, ["https://example.com/c/"])
        self.assertEqual(inventory.pages_missing_h1, ["https://example.com/c/"])
        summary = inventory.summary()
        self.assertEqual(summary["page_count"], 3)
        self.assertEqual(summary["duplicate_title_count"], 2)

    def test_sitemap_errors_do_not_fail_inventory(self):
        with tempfile.TemporaryDirectory() as raw:
            directory = Path(raw)
            write_internal_csv(directory, [page_row("https://example.com/")])
            with (
                patch(
                    "modules.site_inventory.validate_public_audit_url",
                    side_effect=lambda value: value,
                ),
                patch(
                    "modules.site_inventory.fetch_sitemap_urls",
                    side_effect=RuntimeError("no sitemap"),
                ),
            ):
                inventory = build_site_inventory(directory, "https://example.com/")

        self.assertEqual(len(inventory.pages), 1)
        self.assertEqual(inventory.sitemap_errors, ["no sitemap"])


if __name__ == "__main__":
    unittest.main()
