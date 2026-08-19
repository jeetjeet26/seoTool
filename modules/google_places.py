"""Google geocoding and Places-based competitor selection."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import urlsplit

import requests

GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json"
TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACE_FIELDS = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.primaryType",
        "places.types",
        "places.formattedAddress",
        "places.addressComponents",
        "places.location",
        "places.businessStatus",
        "places.websiteUri",
        "places.rating",
        "places.userRatingCount",
    ]
)
EARTH_RADIUS_MILES = 3958.8
DISALLOWED_COMPETITOR_TYPES = {
    "bar",
    "brewery",
    "hotel",
    "lodging",
    "motel",
    "restaurant",
}


class GooglePlacesError(RuntimeError):
    """Raised when Google cannot resolve a requested location."""


@dataclass(frozen=True)
class GeoLocation:
    latitude: float
    longitude: float
    formatted_address: str
    locality: str
    region: str
    place_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "latitude": self.latitude,
            "longitude": self.longitude,
            "formatted_address": self.formatted_address,
            "locality": self.locality,
            "region": self.region,
            "place_id": self.place_id,
        }


class GooglePlacesClient:
    def __init__(
        self,
        api_key: str = "",
        session: requests.Session | None = None,
        timeout: float = 15,
    ):
        self.api_key = api_key.strip()
        self.session = session or requests.Session()
        self.timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def geocode(self, address: str) -> GeoLocation:
        if not self.enabled:
            raise GooglePlacesError("Google Places is not configured")
        response = self.session.get(
            GEOCODING_URL,
            params={"address": address, "key": self.api_key, "region": "us"},
            timeout=self.timeout,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") != "OK" or not payload.get("results"):
            status = str(payload.get("status") or "no results")
            raise GooglePlacesError(f"Google geocoding failed: {status}")
        result = payload["results"][0]
        location = result.get("geometry", {}).get("location", {})
        return GeoLocation(
            latitude=float(location["lat"]),
            longitude=float(location["lng"]),
            formatted_address=str(result.get("formatted_address") or address),
            locality=_component(result.get("address_components"), "locality"),
            region=_component(
                result.get("address_components"),
                "administrative_area_level_1",
                short=True,
            ),
            place_id=str(result.get("place_id") or ""),
        )

    def select_competitors(
        self,
        *,
        property_address: str,
        fallback_location: str,
        competitor_names: list[str],
        radius_miles: float = 75,
        limit: int = 10,
    ) -> tuple[GeoLocation, list[dict[str, Any]]]:
        origin = self.geocode(property_address or fallback_location)
        resolved: list[dict[str, Any]] = []
        for input_index, raw_name in enumerate(competitor_names):
            name, builder = _split_name_builder(raw_name)
            if not name:
                continue
            query_location = ", ".join(
                value for value in (origin.locality, origin.region) if value
            )
            query_name = f"{name} by {builder}" if builder else name
            payload = {
                "textQuery": f"{query_name}, {query_location}".strip(", "),
                "pageSize": 5,
                "locationBias": {
                    "circle": {
                        "center": {
                            "latitude": origin.latitude,
                            "longitude": origin.longitude,
                        },
                        "radius": min(radius_miles * 1609.344, 50000),
                    }
                },
            }
            response = self.session.post(
                TEXT_SEARCH_URL,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": self.api_key,
                    "X-Goog-FieldMask": PLACE_FIELDS,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            places = response.json().get("places") or []
            candidates = [
                candidate
                for place in places
                if (
                    candidate := _score_place(
                        place,
                        requested_name=name,
                        builder=builder,
                        origin=origin,
                        radius_miles=radius_miles,
                        input_index=input_index,
                    )
                )
            ]
            if candidates:
                resolved.append(
                    sorted(
                        candidates,
                        key=lambda item: (
                            -item["score"],
                            item["distance_miles"],
                            item["name"].lower(),
                            item["place_id"],
                        ),
                    )[0]
                )

        deduplicated: dict[str, dict[str, Any]] = {}
        for item in resolved:
            key = (
                item["place_id"]
                or _domain(item.get("url", ""))
                or f"{_normalize(item['name'])}|{_normalize(item['address'])}"
            )
            existing = deduplicated.get(key)
            if existing is None or _rank_key(item) < _rank_key(existing):
                deduplicated[key] = item
        verified_by_input = {
            int(item.get("_input_index") or 0): item
            for item in sorted(deduplicated.values(), key=_rank_key)
        }
        selected: list[dict[str, Any]] = []
        for input_index, raw_name in enumerate(competitor_names):
            item = verified_by_input.get(input_index)
            if item is None:
                name, builder = _split_name_builder(raw_name)
                item = {
                    "name": name,
                    "builder": builder,
                    "location": ", ".join(
                        value for value in (origin.locality, origin.region) if value
                    ),
                    "address": "",
                    "url": "",
                    "place_id": "",
                    "score": 0,
                    "source": "provided",
                    "resolution_status": "unverified",
                    "_input_index": input_index,
                }
            item["priority"] = input_index + 1
            selected.append(item)
            if len(selected) >= limit:
                break
        for item in selected:
            item.pop("_input_index", None)
        return origin, selected


def split_competitor_inputs(value: Any) -> tuple[list[str], list[str]]:
    """Return community names and domains without splitting address commas."""
    if isinstance(value, list):
        entries = [str(item).strip() for item in value if str(item).strip()]
    else:
        entries = [
            item.strip()
            for item in re.split(r"[\n;]+", str(value or ""))
            if item.strip()
        ]
    names: list[str] = []
    domains: list[str] = []
    for entry in entries:
        domain = _domain(entry)
        if domain and (
            "://" in entry
            or re.fullmatch(
                r"(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:/.*)?",
                entry,
                flags=re.IGNORECASE,
            )
        ):
            if domain not in domains:
                domains.append(domain)
        elif entry not in names:
            names.append(entry)
    return names, domains


def _score_place(
    place: dict[str, Any],
    *,
    requested_name: str,
    builder: str,
    origin: GeoLocation,
    radius_miles: float,
    input_index: int,
) -> dict[str, Any] | None:
    status = str(place.get("businessStatus") or "OPERATIONAL")
    if status == "CLOSED_PERMANENTLY":
        return None
    place_types = {
        str(value).lower()
        for value in [
            *(place.get("types") or []),
            place.get("primaryType") or "",
        ]
        if value
    }
    if place_types & DISALLOWED_COMPETITOR_TYPES:
        return None
    display_name = place.get("displayName") or {}
    name = str(
        display_name.get("text")
        if isinstance(display_name, dict)
        else display_name
        or ""
    ).strip()
    if not _has_distinctive_match(requested_name, name, origin.locality):
        return None
    similarity = _name_similarity(requested_name, name)
    if similarity < 0.45:
        return None
    if (
        builder
        and similarity < 0.95
        and not _has_builder_match(
            builder,
            name,
            str(place.get("websiteUri") or ""),
        )
    ):
        return None
    location = place.get("location") or {}
    try:
        latitude = float(location["latitude"])
        longitude = float(location["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    distance = _distance_miles(
        origin.latitude,
        origin.longitude,
        latitude,
        longitude,
    )
    if distance > radius_miles:
        return None
    components = place.get("addressComponents") or []
    locality = _component(components, "locality")
    region = _component(components, "administrative_area_level_1", short=True)
    if origin.region and region and origin.region.lower() != region.lower():
        return None
    same_locality = bool(
        origin.locality
        and locality
        and _normalize(origin.locality) == _normalize(locality)
    )
    score = round(
        similarity * 40
        + max(0, 30 * (1 - distance / radius_miles))
        + (15 if same_locality else 0)
        + (5 if origin.region and region else 0)
        + (5 if status in {"OPERATIONAL", "FUTURE_OPENING"} else 0)
        + (5 if place.get("websiteUri") else 0),
        2,
    )
    return {
        "name": name,
        "builder": builder,
        "location": ", ".join(value for value in (locality, region) if value)
        or str(place.get("formattedAddress") or ""),
        "address": str(place.get("formattedAddress") or ""),
        "url": str(place.get("websiteUri") or ""),
        "place_id": str(place.get("id") or ""),
        "latitude": latitude,
        "longitude": longitude,
        "distance_miles": round(distance, 1),
        "rating": place.get("rating"),
        "review_count": place.get("userRatingCount"),
        "score": score,
        "source": "google_places",
        "resolution_status": "verified",
        "_input_index": input_index,
    }


def _rank_key(item: dict[str, Any]) -> tuple:
    return (
        -float(item.get("score") or 0),
        float(item.get("distance_miles") or math.inf),
        int(item.get("_input_index") or 0),
        str(item.get("name") or "").lower(),
        str(item.get("place_id") or ""),
    )


def _name_similarity(requested: str, resolved: str) -> float:
    left = _normalize(requested)
    right = _normalize(resolved)
    if not left or not right:
        return 0
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    overlap = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
    sequence = SequenceMatcher(None, left, right).ratio()
    contains = 0.9 if left in right or right in left else 0.0
    return max(overlap, sequence, contains)


def _has_distinctive_match(requested: str, resolved: str, _locality: str) -> bool:
    generic_tokens = {
        "at",
        "apartment",
        "apartments",
        "by",
        "community",
        "homes",
        "independent",
        "living",
        "new",
        "residential",
        "senior",
        "the",
    }
    requested_tokens = (
        set(_normalize(requested).split()) - generic_tokens
    )
    resolved_tokens = set(_normalize(resolved).split())
    return bool(requested_tokens) and requested_tokens <= resolved_tokens


def _has_builder_match(builder: str, resolved_name: str, website: str) -> bool:
    generic_tokens = {
        "and",
        "at",
        "brothers",
        "builders",
        "community",
        "homes",
        "residential",
        "the",
    }
    builder_tokens = set(_normalize(builder).split()) - generic_tokens
    evidence = _normalize(
        f"{resolved_name} {_domain(website).replace('.', ' ')}"
    ).replace(" ", "")
    return not builder_tokens or any(token in evidence for token in builder_tokens)


def _split_name_builder(value: str) -> tuple[str, str]:
    parts = re.split(r"\s+by\s+", value.strip(), maxsplit=1, flags=re.IGNORECASE)
    return parts[0].strip(), parts[1].strip() if len(parts) > 1 else ""


def _component(
    components: list[dict[str, Any]] | None,
    component_type: str,
    *,
    short: bool = False,
) -> str:
    for component in components or []:
        if component_type not in (component.get("types") or []):
            continue
        if short:
            return str(
                component.get("short_name")
                or component.get("shortText")
                or component.get("long_name")
                or component.get("longText")
                or ""
            )
        return str(
            component.get("long_name")
            or component.get("longText")
            or component.get("short_name")
            or component.get("shortText")
            or ""
        )
    return ""


def _distance_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(delta_lon / 2) ** 2
    )
    return EARTH_RADIUS_MILES * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _normalize(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def _domain(value: str) -> str:
    raw = value.strip()
    if not raw:
        return ""
    parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    return (parsed.hostname or "").lower().removeprefix("www.")
