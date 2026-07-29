import json
import unittest

from modules.schema_generator import (
    SchemaValidationError,
    build_apartment_community,
    build_floor_plan,
    to_script_tag,
    validate_apartment_community,
    validate_floor_plan,
)

FACTS = {
    "name": "Alexan West End",
    "url": "https://example.com/",
    "street_address": "123 Main St",
    "city": "Dallas",
    "region": "TX",
    "postal_code": "75201",
}


class SchemaGeneratorTests(unittest.TestCase):
    def test_builds_valid_community(self):
        document = build_apartment_community(
            {
                **FACTS,
                "telephone": "555-0100",
                "latitude": 32.78,
                "longitude": -96.8,
                "amenities": ["Pool", "Gym"],
                "pets_allowed": True,
            }
        )
        self.assertEqual(document["@type"], "ApartmentComplex")
        self.assertEqual(document["address"]["addressLocality"], "Dallas")
        self.assertEqual(document["geo"]["latitude"], 32.78)
        self.assertEqual(len(document["amenityFeature"]), 2)
        self.assertTrue(document["petsAllowed"])
        # Round-trips as JSON.
        json.dumps(document)

    def test_never_invents_missing_facts(self):
        document = build_apartment_community(FACTS)
        for absent in ("geo", "telephone", "amenityFeature", "petsAllowed", "offers"):
            self.assertNotIn(absent, document)

    def test_missing_required_fields_fail_validation(self):
        problems = validate_apartment_community({"name": "X"})
        self.assertTrue(any("url" in problem for problem in problems))
        with self.assertRaises(SchemaValidationError):
            build_apartment_community({"name": "X"})

    def test_coordinates_must_come_together_and_be_valid(self):
        problems = validate_apartment_community({**FACTS, "latitude": 10})
        self.assertIn("latitude and longitude must be supplied together", problems)
        problems = validate_apartment_community(
            {**FACTS, "latitude": 200, "longitude": 10}
        )
        self.assertIn("latitude out of range", problems)

    def test_floor_plan_with_offer(self):
        plan = build_floor_plan(
            {
                "name": "A1",
                "url": "https://example.com/floorplans/a1/",
                "bedrooms": 1,
                "bathrooms": 1,
                "square_feet": 750,
                "rent_from": 1500,
            }
        )
        self.assertEqual(plan["@type"], "FloorPlan")
        self.assertEqual(plan["floorSize"]["value"], 750.0)
        self.assertEqual(plan["offers"]["price"], 1500.0)
        self.assertEqual(plan["offers"]["priceCurrency"], "USD")

    def test_floor_plan_validation(self):
        self.assertTrue(validate_floor_plan({"name": "A1"}))
        self.assertIn(
            "bedrooms must be numeric",
            validate_floor_plan(
                {"name": "A1", "url": "https://example.com/", "bedrooms": "two"}
            ),
        )

    def test_nested_floor_plans_in_community(self):
        document = build_apartment_community(
            {
                **FACTS,
                "floor_plans": [
                    {"name": "A1", "url": "https://example.com/floorplans/a1/"}
                ],
            }
        )
        self.assertEqual(document["containsPlace"][0]["@type"], "FloorPlan")

    def test_script_tag_escapes_closing_tags(self):
        document = build_apartment_community(
            {**FACTS, "description": "Great pool</script><script>alert(1)"}
        )
        tag = to_script_tag(document)
        self.assertTrue(tag.startswith('<script type="application/ld+json">'))
        self.assertNotIn("</script><script>", tag)


if __name__ == "__main__":
    unittest.main()
