import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.http_inventory import (
    _PageParser,
    _scoped_candidates,
    build_http_inventory,
)


class HttpInventoryTests(unittest.TestCase):
    def test_scopes_sitemap_to_requested_property_path(self):
        urls = _scoped_candidates(
            "https://example.com/communities/persimmon/",
            [
                "https://example.com/",
                "https://example.com/communities/persimmon/",
                "https://example.com/communities/persimmon/gallery/",
                "https://example.com/communities/other/",
            ],
            250,
        )
        self.assertEqual(
            urls,
            [
                "https://example.com/communities/persimmon/",
                "https://example.com/communities/persimmon/gallery/",
            ],
        )

    def test_parser_ignores_navigation_and_scripts(self):
        parser = _PageParser()
        parser.feed(
            "<html><head><title>Property</title><meta name='description' "
            "content='Description'></head><body><nav>Menu links</nav>"
            "<h1>Homes for sale</h1><p>Useful page copy here.</p>"
            "<script>ignored words</script></body></html>"
        )
        self.assertEqual(parser.title, "Property")
        self.assertEqual(parser.h1, "Homes for sale")
        self.assertNotIn("ignored", parser._body_words)

    def test_writes_screaming_frog_compatible_inventory(self):
        row = {
            "Address": "https://example.com/",
            "Status Code": 200,
            "Content Type": "text/html",
            "Indexability": "Indexable",
            "Title 1": "Example",
            "Title 1 Length": 7,
            "Meta Description 1": "Description",
            "Meta Description 1 Length": 11,
            "H1-1": "Heading",
            "H2-1": "",
            "Canonical Link Element 1": "https://example.com/",
            "Word Count": 100,
        }
        with tempfile.TemporaryDirectory() as directory:
            with (
                patch(
                    "modules.http_inventory.fetch_sitemap_urls",
                    return_value=["https://example.com/"],
                ),
                patch("modules.http_inventory._fetch_page", return_value=row),
            ):
                result = build_http_inventory(
                    "https://example.com/",
                    Path(directory),
                    10,
                )
            with (Path(directory) / "internal_all.csv").open(
                encoding="utf-8-sig",
                newline="",
            ) as stream:
                rows = list(csv.DictReader(stream))
        self.assertEqual(result["pages"], 1)
        self.assertEqual(rows[0]["Title 1"], "Example")


if __name__ == "__main__":
    unittest.main()
