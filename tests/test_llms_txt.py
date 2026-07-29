import unittest

from modules.llms_txt import generate_llms_txt, validate_llms_txt

PAGES = [
    {
        "url": "https://example.com/",
        "title": "Example Apartments",
        "meta_description": "Apartments in Dallas.",
    },
    {
        "url": "https://example.com/floor-plans/",
        "title": "Floor Plans",
        "meta_description": "Studio to 3 bedroom layouts.",
    },
    {"url": "https://example.com/amenities/", "title": "Amenities"},
    {"url": "https://example.com/privacy-policy/", "title": "Privacy"},
    {"url": "https://other-site.com/page/", "title": "Elsewhere"},
]


class LlmsTxtTests(unittest.TestCase):
    def test_output_is_deterministic(self):
        first = generate_llms_txt("Example", "https://example.com/", "Apartments.", PAGES)
        second = generate_llms_txt(
            "Example", "https://example.com/", "Apartments.", list(reversed(PAGES))
        )
        self.assertEqual(first, second)

    def test_structure_and_filtering(self):
        content = generate_llms_txt(
            "Example", "https://example.com/", "Apartments in Dallas.", PAGES
        )
        self.assertTrue(content.startswith("# Example\n"))
        self.assertIn("> Apartments in Dallas.", content)
        self.assertIn("## Floor Plans", content)
        self.assertIn(
            "- [Floor Plans](https://example.com/floor-plans/): Studio to 3 bedroom layouts.",
            content,
        )
        # Off-site and excluded paths never appear.
        self.assertNotIn("other-site.com", content)
        self.assertNotIn("privacy", content.lower())

    def test_duplicate_urls_are_removed(self):
        pages = PAGES + [{"url": "https://example.com/floor-plans", "title": "Dup"}]
        content = generate_llms_txt("Example", "https://example.com/", "", pages)
        self.assertEqual(content.count("floor-plans"), 1)

    def test_validation(self):
        good = generate_llms_txt("Example", "https://example.com/", "", PAGES)
        self.assertEqual(validate_llms_txt(good), [])
        self.assertTrue(validate_llms_txt("no heading"))
        self.assertTrue(validate_llms_txt("# Site\n\n- [x](notaurl)"))


if __name__ == "__main__":
    unittest.main()
