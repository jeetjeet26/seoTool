import unittest
from unittest.mock import patch

from modules.page_content import _VisibleTextParser, fetch_body_copy_for_pages


class PageContentTests(unittest.TestCase):
    def test_extracts_main_copy_without_navigation_or_footer(self):
        parser = _VisibleTextParser()
        parser.feed(
            """
            <html><body>
              <nav>Home Services Contact</nav>
              <main>
                <h1>Luxury apartments</h1>
                <p>Discover thoughtfully designed apartment homes with useful
                community amenities and convenient access to the neighborhood.</p>
                <p>Schedule a tour to explore available floor plans and learn
                more about the resident experience at this community.</p>
              </main>
              <footer>Privacy policy and social links</footer>
            </body></html>
            """
        )
        text = parser.body_text()
        self.assertIn("Luxury apartments", text)
        self.assertIn("Schedule a tour", text)
        self.assertNotIn("Home Services Contact", text)
        self.assertNotIn("Privacy policy", text)
        self.assertIn("Discover thoughtfully designed", parser.rewrite_block())
        self.assertNotIn("Schedule a tour", parser.rewrite_block())

    def test_batch_fetch_isolates_page_failures(self):
        with patch(
            "modules.page_content.fetch_visible_body_copy",
            side_effect=[
                {"url": "https://a.example/", "body_text": "Copy", "body_word_count": 1},
                RuntimeError("failed"),
            ],
        ):
            results, errors = fetch_body_copy_for_pages(
                ["https://a.example/", "https://b.example/"],
                workers=1,
            )
        self.assertEqual(results["https://a.example/"]["body_text"], "Copy")
        self.assertEqual(len(errors), 1)
        self.assertIn("https://b.example/", errors[0])


if __name__ == "__main__":
    unittest.main()
