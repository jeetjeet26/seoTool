"""Validated JSON-LD builders for apartment communities and floor plans.

Builders only emit fields that were actually supplied - business facts are
never invented. `validate_*` functions return human-readable problems so staff
can fix inputs before approving the schema for publication.
"""

from __future__ import annotations

import json
from typing import Any

SCHEMA_CONTEXT = "https://schema.org"

REQUIRED_COMMUNITY_FIELDS = ("name", "url", "street_address", "city", "region", "postal_code")
REQUIRED_FLOOR_PLAN_FIELDS = ("name", "url")


class SchemaValidationError(ValueError):
    """Raised when required schema facts are missing or malformed."""


def build_apartment_community(facts: dict[str, Any]) -> dict[str, Any]:
    """JSON-LD ApartmentComplex from supplied facts only.

    Expected fact keys (all optional unless in REQUIRED_COMMUNITY_FIELDS):
    name, url, description, telephone, street_address, city, region,
    postal_code, country (default US), latitude, longitude, images (list),
    amenities (list), pets_allowed (bool), number_of_units (int).
    """

    problems = validate_apartment_community(facts)
    if problems:
        raise SchemaValidationError("; ".join(problems))

    document: dict[str, Any] = {
        "@context": SCHEMA_CONTEXT,
        "@type": "ApartmentComplex",
        "name": facts["name"].strip(),
        "url": facts["url"].strip(),
        "address": {
            "@type": "PostalAddress",
            "streetAddress": facts["street_address"].strip(),
            "addressLocality": facts["city"].strip(),
            "addressRegion": facts["region"].strip(),
            "postalCode": str(facts["postal_code"]).strip(),
            "addressCountry": str(facts.get("country") or "US").strip(),
        },
    }

    if facts.get("description"):
        document["description"] = str(facts["description"]).strip()
    if facts.get("telephone"):
        document["telephone"] = str(facts["telephone"]).strip()
    latitude, longitude = facts.get("latitude"), facts.get("longitude")
    if latitude is not None and longitude is not None:
        document["geo"] = {
            "@type": "GeoCoordinates",
            "latitude": float(latitude),
            "longitude": float(longitude),
        }
    images = [str(url).strip() for url in facts.get("images") or [] if str(url).strip()]
    if images:
        document["image"] = images
    amenities = [str(a).strip() for a in facts.get("amenities") or [] if str(a).strip()]
    if amenities:
        document["amenityFeature"] = [
            {"@type": "LocationFeatureSpecification", "name": amenity, "value": True}
            for amenity in amenities
        ]
    if facts.get("pets_allowed") is not None:
        document["petsAllowed"] = bool(facts["pets_allowed"])
    if facts.get("number_of_units"):
        document["numberOfAccommodationUnits"] = int(facts["number_of_units"])

    floor_plans = [
        build_floor_plan(plan_facts, validate=False)
        for plan_facts in facts.get("floor_plans") or []
        if not validate_floor_plan(plan_facts)
    ]
    if floor_plans:
        document["containsPlace"] = floor_plans

    return document


def build_floor_plan(facts: dict[str, Any], validate: bool = True) -> dict[str, Any]:
    """JSON-LD FloorPlan from supplied facts only.

    Expected keys: name, url, bedrooms, bathrooms, square_feet, image,
    rent_from (numeric), rent_currency (default USD), availability.
    """

    if validate:
        problems = validate_floor_plan(facts)
        if problems:
            raise SchemaValidationError("; ".join(problems))

    document: dict[str, Any] = {
        "@type": "FloorPlan",
        "name": str(facts["name"]).strip(),
        "url": str(facts["url"]).strip(),
    }
    if facts.get("bedrooms") is not None:
        document["numberOfBedrooms"] = float(facts["bedrooms"])
    if facts.get("bathrooms") is not None:
        document["numberOfBathroomsTotal"] = float(facts["bathrooms"])
    if facts.get("square_feet"):
        document["floorSize"] = {
            "@type": "QuantitativeValue",
            "value": float(facts["square_feet"]),
            "unitCode": "FTK",
        }
    if facts.get("image"):
        document["image"] = str(facts["image"]).strip()
    if facts.get("rent_from") is not None:
        document["offers"] = {
            "@type": "Offer",
            "price": float(facts["rent_from"]),
            "priceCurrency": str(facts.get("rent_currency") or "USD"),
            **(
                {"availability": str(facts["availability"]).strip()}
                if facts.get("availability")
                else {}
            ),
        }
    return document


def validate_apartment_community(facts: dict[str, Any]) -> list[str]:
    problems = [
        f"Missing required field: {field}"
        for field in REQUIRED_COMMUNITY_FIELDS
        if not str(facts.get(field) or "").strip()
    ]
    url = str(facts.get("url") or "")
    if url and not url.startswith(("http://", "https://")):
        problems.append("url must be an absolute http(s) URL")
    latitude, longitude = facts.get("latitude"), facts.get("longitude")
    if (latitude is None) != (longitude is None):
        problems.append("latitude and longitude must be supplied together")
    for coordinate, bound in (("latitude", 90), ("longitude", 180)):
        value = facts.get(coordinate)
        if value is not None:
            try:
                if abs(float(value)) > bound:
                    problems.append(f"{coordinate} out of range")
            except (TypeError, ValueError):
                problems.append(f"{coordinate} must be numeric")
    for plan in facts.get("floor_plans") or []:
        problems.extend(
            f"floor plan '{plan.get('name', '?')}': {problem}"
            for problem in validate_floor_plan(plan)
        )
    return problems


def validate_floor_plan(facts: dict[str, Any]) -> list[str]:
    problems = [
        f"Missing required field: {field}"
        for field in REQUIRED_FLOOR_PLAN_FIELDS
        if not str(facts.get(field) or "").strip()
    ]
    url = str(facts.get("url") or "")
    if url and not url.startswith(("http://", "https://")):
        problems.append("url must be an absolute http(s) URL")
    for numeric in ("bedrooms", "bathrooms", "square_feet", "rent_from"):
        value = facts.get(numeric)
        if value is not None:
            try:
                if float(value) < 0:
                    problems.append(f"{numeric} must not be negative")
            except (TypeError, ValueError):
                problems.append(f"{numeric} must be numeric")
    return problems


def to_script_tag(document: dict[str, Any]) -> str:
    """Render a JSON-LD document as a copy-ready script tag."""
    body = json.dumps(document, indent=2, ensure_ascii=False)
    # A literal `</script>` inside the JSON body would break out of the tag.
    body = body.replace("</", "<\\/")
    return f'<script type="application/ld+json">\n{body}\n</script>'
