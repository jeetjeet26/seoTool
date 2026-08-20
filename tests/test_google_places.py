import unittest

from modules.google_places import GooglePlacesClient, split_competitor_inputs


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, searches):
        self.searches = searches
        self.requests = []

    def get(self, url, params, timeout):
        self.requests.append(("GET", url, params))
        return FakeResponse(
            {
                "status": "OK",
                "results": [
                    {
                        "place_id": "subject-place",
                        "formatted_address": (
                            "22045 Garibaldi Dr, Walnut, CA 91789, USA"
                        ),
                        "geometry": {
                            "location": {"lat": 34.0320255, "lng": -117.8287664}
                        },
                        "address_components": [
                            {
                                "long_name": "Walnut",
                                "short_name": "Walnut",
                                "types": ["locality"],
                            },
                            {
                                "long_name": "California",
                                "short_name": "CA",
                                "types": ["administrative_area_level_1"],
                            },
                        ],
                    }
                ],
            }
        )

    def post(self, url, json, headers, timeout):
        self.requests.append(("POST", url, json))
        return FakeResponse({"places": self.searches.get(json["textQuery"], [])})


def place(
    place_id,
    name,
    latitude,
    longitude,
    locality,
    *,
    region="CA",
    website=True,
    status="OPERATIONAL",
    types=None,
):
    return {
        "id": place_id,
        "displayName": {"text": name},
        "formattedAddress": f"1 Main St, {locality}, {region}",
        "addressComponents": [
            {"longText": locality, "shortText": locality, "types": ["locality"]},
            {
                "longText": "California",
                "shortText": region,
                "types": ["administrative_area_level_1"],
            },
        ],
        "location": {"latitude": latitude, "longitude": longitude},
        "businessStatus": status,
        "websiteUri": f"https://{place_id}.example.com" if website else "",
        "rating": 4.5,
        "userRatingCount": 25,
        "types": types or [],
    }


class GooglePlacesClientTests(unittest.TestCase):
    def test_splits_names_without_breaking_address_commas(self):
        names, domains = split_competitor_inputs(
            "Sella by Lennar, Hacienda Heights, CA\n"
            "https://example.com/community\n"
            "Magnolia by Brookfield"
        )
        self.assertEqual(
            names,
            [
                "Sella by Lennar, Hacienda Heights, CA",
                "Magnolia by Brookfield",
            ],
        )
        self.assertEqual(domains, ["example.com"])

    def test_bracketed_community_names_are_not_treated_as_ipv6_hosts(self):
        names, domains = split_competitor_inputs(
            "[overture tributary]\n"
            "[avenues of south hoover]\n"
            "[filmont liberty park"
        )
        self.assertEqual(
            names,
            [
                "overture tributary",
                "avenues of south hoover",
                "filmont liberty park",
            ],
        )
        self.assertEqual(domains, [])

    def test_selects_nearby_place_and_rejects_walnut_creek(self):
        session = FakeSession(
            {
                "Brookfield Walnut, Walnut, CA": [
                    place(
                        "wrong-market",
                        "Brookfield Walnut",
                        37.9101,
                        -122.0652,
                        "Walnut Creek",
                    ),
                    place(
                        "nearby",
                        "Brookfield Walnut",
                        34.062,
                        -117.76,
                        "Pomona",
                    ),
                ]
            }
        )
        client = GooglePlacesClient("test-key", session=session)
        origin, competitors = client.select_competitors(
            property_address="22045 Garibaldi Dr, Walnut, CA 91789",
            fallback_location="Walnut, CA",
            competitor_names=["Brookfield Walnut"],
        )
        self.assertEqual(origin.locality, "Walnut")
        self.assertEqual([item["place_id"] for item in competitors], ["nearby"])
        self.assertLess(competitors[0]["distance_miles"], 75)

    def test_deduplicates_and_caps_deterministically(self):
        searches = {}
        names = []
        for index in range(12):
            name = f"Community {index}"
            names.append(name)
            searches[f"{name}, Walnut, CA"] = [
                place(
                    "duplicate" if index == 11 else f"place-{index}",
                    name,
                    34.032 + index * 0.001,
                    -117.828,
                    "Walnut",
                )
            ]
        searches["Community 0, Walnut, CA"][0]["id"] = "duplicate"
        client = GooglePlacesClient("test-key", session=FakeSession(searches))
        _, competitors = client.select_competitors(
            property_address="22045 Garibaldi Dr, Walnut, CA 91789",
            fallback_location="Walnut, CA",
            competitor_names=names,
            limit=10,
        )
        self.assertEqual(len(competitors), 10)
        self.assertEqual(len({item["place_id"] for item in competitors}), 10)
        self.assertEqual(competitors[0]["name"], "Community 0")

    def test_rejects_closed_and_weak_name_matches(self):
        session = FakeSession(
            {
                "Sella, Walnut, CA": [
                    place(
                        "closed",
                        "Sella",
                        34.04,
                        -117.82,
                        "Walnut",
                        status="CLOSED_PERMANENTLY",
                    ),
                    place(
                        "unrelated",
                        "Generic Apartments",
                        34.04,
                        -117.82,
                        "Walnut",
                    ),
                ]
            }
        )
        client = GooglePlacesClient("test-key", session=session)
        _, competitors = client.select_competitors(
            property_address="22045 Garibaldi Dr, Walnut, CA 91789",
            fallback_location="Walnut, CA",
            competitor_names=["Sella"],
        )
        self.assertEqual(competitors[0]["name"], "Sella")
        self.assertEqual(competitors[0]["resolution_status"], "unverified")

    def test_location_name_alone_cannot_match_competitor_brand(self):
        session = FakeSession(
            {
                "Brookfield Walnut, Walnut, CA": [
                    place(
                        "city",
                        "City of Walnut",
                        34.04,
                        -117.82,
                        "Walnut",
                    )
                ]
            }
        )
        client = GooglePlacesClient("test-key", session=session)
        _, competitors = client.select_competitors(
            property_address="22045 Garibaldi Dr, Walnut, CA 91789",
            fallback_location="Walnut, CA",
            competitor_names=["Brookfield Walnut"],
        )
        self.assertEqual(competitors[0]["name"], "Brookfield Walnut")
        self.assertEqual(competitors[0]["resolution_status"], "unverified")

    def test_hotel_match_is_not_verified_as_a_competitor_community(self):
        session = FakeSession(
            {
                "Homewood Suites, Walnut, CA": [
                    place(
                        "hotel",
                        "Homewood Suites",
                        34.04,
                        -117.82,
                        "Walnut",
                        types=["hotel", "lodging"],
                    )
                ]
            }
        )
        client = GooglePlacesClient("test-key", session=session)
        _, competitors = client.select_competitors(
            property_address="22045 Garibaldi Dr, Walnut, CA 91789",
            fallback_location="Walnut, CA",
            competitor_names=["Homewood Suites"],
        )
        self.assertEqual(competitors[0]["name"], "Homewood Suites")
        self.assertEqual(competitors[0]["resolution_status"], "unverified")
        self.assertEqual(competitors[0]["url"], "")

    def test_partial_name_and_wrong_locality_stay_unverified(self):
        session = FakeSession(
            {
                "Tuxedo Terrace Apartments, Walnut, CA": [
                    place(
                        "partial",
                        "Tuxedo Park Apartments",
                        34.04,
                        -117.82,
                        "Walnut",
                    )
                ],
                "Colina Apartments Walnut, Walnut, CA": [
                    place(
                        "wrong-city",
                        "Colina Apartments",
                        34.04,
                        -117.82,
                        "Pomona",
                    )
                ],
            }
        )
        client = GooglePlacesClient("test-key", session=session)
        _, competitors = client.select_competitors(
            property_address="22045 Garibaldi Dr, Walnut, CA 91789",
            fallback_location="Walnut, CA",
            competitor_names=[
                "Tuxedo Terrace Apartments",
                "Colina Apartments Walnut",
            ],
        )
        self.assertEqual(
            [item["resolution_status"] for item in competitors],
            ["unverified", "unverified"],
        )
        self.assertEqual(
            [item["name"] for item in competitors],
            ["Tuxedo Terrace Apartments", "Colina Apartments Walnut"],
        )

    def test_supplied_builder_must_match_name_or_website(self):
        wrong = place(
            "wrong-builder",
            "Magnolia Street East",
            34.04,
            -117.82,
            "Walnut",
            website=False,
        )
        correct = place(
            "correct-builder",
            "Magnolia",
            34.13,
            -118.03,
            "Arcadia",
        )
        correct["websiteUri"] = "https://www.brookfieldresidential.com/magnolia"
        session = FakeSession(
            {
                "Magnolia by Brookfield Residential, Walnut, CA": [wrong, correct],
            }
        )
        client = GooglePlacesClient("test-key", session=session)
        _, competitors = client.select_competitors(
            property_address="22045 Garibaldi Dr, Walnut, CA 91789",
            fallback_location="Walnut, CA",
            competitor_names=["Magnolia by Brookfield Residential"],
        )
        self.assertEqual(
            [item["place_id"] for item in competitors],
            ["correct-builder"],
        )


if __name__ == "__main__":
    unittest.main()
