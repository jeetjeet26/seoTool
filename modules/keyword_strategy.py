"""Evidence-backed keyword discovery, scoring, and landing-page assignment.

Replaces the previous hard-coded location phrases. Candidates come from three
attributed sources: current Semrush rankings, location seed phrases, and
Semrush related-keyword ideas. Every candidate keeps its raw metrics so staff
can understand and override the recommendation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

SHARED_TRANSACTIONAL_MARKERS = (
    "specials",
    "tour",
    "apply",
    "availability",
    "available now",
    "move in",
    "move-in",
    "contact",
)
TRANSACTIONAL_MARKERS_BY_VERTICAL = {
    "multifamily": (
        "for rent",
        "rent ",
        " rentals",
        "lease",
        "leasing",
    ),
    "senior_housing": (
        "pricing",
        "for rent",
        "lease",
    ),
    "senior_living": (
        "pricing",
        "for rent",
        "lease",
    ),
    "new_homes": (
        "for sale",
        "buy ",
        "purchase",
        "quick move-in",
        "move-in ready",
        "contact builder",
    ),
    "master_planned": (
        "for sale",
        "buy ",
        "purchase",
        "quick move-in",
        "move-in ready",
        "contact builder",
    ),
    "luxury_living": (
        "for sale",
        "buy ",
        "purchase",
        "for rent",
        "lease",
    ),
}
INFORMATIONAL_MARKERS = ("what", "how", "why", "cost of", "average", "guide")
HOUSING_MARKERS = (
    "apartment",
    "apartments",
    "rent",
    "rental",
    "rentals",
    "studio",
    "bedroom",
    "bedrooms",
    "loft",
    "lofts",
    "flat",
    "flats",
    "housing",
    "townhome",
    "townhomes",
)
VERTICAL_MARKERS = {
    "multifamily": HOUSING_MARKERS,
    "senior_housing": (
        "senior", "apartment", "apartments", "community", "communities",
    ),
    "senior_living": (
        "senior", "apartment", "apartments", "community", "communities",
    ),
    "new_homes": (
        "home", "homes", "house", "houses", "townhome", "townhomes",
        "condo", "condominiums", "construction", "builder", "builders",
    ),
    "master_planned": (
        "master", "planned", "community", "communities", "home", "homes",
        "townhome", "townhomes", "construction",
    ),
    "luxury_living": (
        "luxury", "home", "homes", "residence", "residences", "apartment",
        "apartments", "condo", "condominiums", "community", "communities",
    ),
}

PAGE_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("floor-plan", ("bedroom", "studio", "floor plan", "floorplan", "loft")),
    ("floorplan", ("bedroom", "studio", "floor plan", "floorplan", "loft")),
    ("amenit", ("amenit", "luxury", "pet friendly", "pool", "gym", "fitness")),
    ("gallery", ("photo", "gallery", "video")),
    ("neighborhood", ("near", "neighborhood", "downtown", "close to")),
    ("contact", ("contact", "phone", "leasing office")),
    ("tour", ("tour", "visit", "schedule")),
    ("resident", ("resident", "portal", "login")),
)


@dataclass
class KeywordCandidate:
    keyword: str
    source: str  # approved | ranking | seed | related
    volume: int = 0
    cpc: float = 0.0
    difficulty: float = 0.0
    competition: float = 0.0
    position: int | None = None
    landing_page: str = ""
    intent: str = "commercial"
    score: float = 0.0
    assigned_page: str = ""
    evidence: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "keyword": self.keyword,
            "source": self.source,
            "volume": self.volume,
            "cpc": self.cpc,
            "difficulty": self.difficulty,
            "competition": self.competition,
            "position": self.position,
            "landing_page": self.landing_page,
            "intent": self.intent,
            "score": round(self.score, 1),
            "assigned_page": self.assigned_page,
            "evidence": self.evidence,
        }


def seed_phrases(
    location: str,
    property_name: str = "",
    vertical: str = "multifamily",
) -> list[str]:
    """Location seed phrases used to pull related-keyword ideas."""
    # Semrush has substantially better exact-keyword coverage for city-level
    # phrases than long-form values such as "Long Beach, California".
    location = location.split(",", 1)[0].strip()
    if vertical == "new_homes":
        phrases = [
            f"new homes for sale {location}",
            f"homes for sale {location}",
            f"new construction homes {location}",
            f"townhomes for sale {location}",
            f"home builders {location}",
        ]
    elif vertical in {"senior_housing", "senior_living"}:
        phrases = [
            f"55 plus apartments {location}",
            f"senior apartments {location}",
            f"active adult apartments {location}",
            f"55 plus communities {location}",
            f"senior living availability {location}",
        ]
    elif vertical == "master_planned":
        phrases = [
            f"master planned communities {location}",
            f"new homes in {location}",
            f"new construction homes {location}",
            f"homes for sale {location}",
        ]
    elif vertical == "luxury_living":
        phrases = [
            f"luxury homes {location}",
            f"luxury residences {location}",
            f"luxury living {location}",
            f"luxury communities {location}",
            f"luxury residences availability {location}",
        ]
    elif vertical == "corporate":
        phrases = []
    else:
        phrases = [
            f"apartments in {location}",
            f"apartments for rent {location}",
            f"luxury apartments {location}",
            f"pet friendly apartments {location}",
            f"studio apartments {location}",
            f"1 bedroom apartments {location}",
            f"2 bedroom apartments {location}",
            f"3 bedroom apartments {location}",
            f"new apartments {location}",
        ]
    if property_name.strip():
        phrases.insert(0, f"{property_name.strip().lower()} {location}".strip())
    return phrases


def classify_intent(
    keyword: str,
    brand_tokens: set[str],
    vertical: str = "multifamily",
) -> str:
    """Heuristic search-intent codes matching the report convention.

    navigational (brand), transactional, informational, or commercial.
    """
    lowered = f" {keyword.lower()} "
    tokens = set(re.findall(r"[a-z0-9]+", lowered))
    if brand_tokens and brand_tokens & tokens:
        return "navigational"
    transactional_markers = (
        *SHARED_TRANSACTIONAL_MARKERS,
        *TRANSACTIONAL_MARKERS_BY_VERTICAL.get(vertical, ()),
    )
    if any(marker in lowered for marker in transactional_markers):
        return "transactional"
    if any(lowered.strip().startswith(marker) for marker in INFORMATIONAL_MARKERS):
        return "informational"
    return "commercial"


def is_relevant_keyword(
    keyword: str,
    location_tokens: set[str],
    brand_tokens: set[str],
    property_terms: set[str] | None = None,
    excluded_phrases: tuple[str, ...] = (),
    competitor_phrases: tuple[str, ...] = (),
    location_phrases: tuple[str, ...] = (),
    location_suffix_tokens: set[str] | None = None,
    primary_brand_tokens: set[str] | None = None,
) -> bool:
    """Require property fit and market intent while rejecting unsafe targets."""
    lowered = " ".join(keyword.lower().split())
    if any(phrase and phrase in lowered for phrase in excluded_phrases):
        return False
    if any(phrase and phrase in lowered for phrase in competitor_phrases):
        return False
    tokens = set(re.findall(r"[a-z0-9]+", keyword.lower()))
    required_terms = property_terms or set(HOUSING_MARKERS)
    has_housing_intent = not required_terms or bool(tokens & required_terms)
    has_market_signal = (
        _has_approved_location(
            lowered,
            location_phrases,
            required_terms,
            location_suffix_tokens or set(),
        )
        if location_phrases
        else bool(tokens & location_tokens)
    ) or _has_client_brand_signal(tokens, brand_tokens, primary_brand_tokens)
    return has_housing_intent and has_market_signal


def _has_client_brand_signal(
    tokens: set[str],
    brand_tokens: set[str],
    primary_brand_tokens: set[str] | None = None,
) -> bool:
    """Require a distinctive brand match, not a shared word such as knox."""

    if not brand_tokens:
        return False
    if primary_brand_tokens:
        return bool(tokens & primary_brand_tokens) or len(tokens & brand_tokens) >= 2
    return bool(tokens & brand_tokens)


def _primary_brand_tokens(property_name: str) -> set[str]:
    skip = {"www", "com", "net", "org", "the", "and", "for", "apartments"}
    tokens = [
        token
        for token in re.findall(r"[a-z0-9]+", property_name.lower())
        if token not in skip and len(token) > 2
    ]
    return {tokens[0]} if tokens else set()


def _has_approved_location(
    keyword: str,
    location_phrases: tuple[str, ...],
    property_terms: set[str],
    suffix_tokens: set[str],
) -> bool:
    words = re.findall(r"[a-z0-9]+", keyword)
    allowed_after_single_city = {
        "ca", "tx", "fl", "ga", "az", "nv", "hi", "il", "ny", "nj",
        "new", "luxury", "for", "in", "near", "area", "county",
        *property_terms,
        *suffix_tokens,
    }
    for phrase in location_phrases:
        parts = re.findall(r"[a-z0-9]+", phrase)
        if not parts:
            continue
        for index in range(0, len(words) - len(parts) + 1):
            if words[index : index + len(parts)] != parts:
                continue
            if len(parts) > 1 or index + 1 >= len(words):
                return True
            following = words[index + 1]
            if following in allowed_after_single_city or following.isdigit():
                return True
    return False


def score_candidate(candidate: KeywordCandidate, location_tokens: set[str]) -> float:
    """0-100 score blending volume, difficulty, ranking opportunity, locality."""
    volume_points = min(40.0, (candidate.volume or 0) ** 0.5 * 4)
    difficulty_points = (
        max(0.0, 25.0 - candidate.difficulty * 0.25)
        if candidate.difficulty or candidate.volume
        else 12.5
    )
    if candidate.position:
        # Ranking 4-20 is the sweet spot: proof of relevance plus headroom.
        if 4 <= candidate.position <= 20:
            rank_points = 20.0
        elif candidate.position <= 3:
            rank_points = 8.0
        else:
            rank_points = 12.0
    else:
        rank_points = 10.0
    keyword_tokens = set(re.findall(r"[a-z0-9]+", candidate.keyword.lower()))
    locality_points = 15.0 if location_tokens & keyword_tokens else 0.0
    return min(100.0, volume_points + difficulty_points + rank_points + locality_points)


def assign_page(keyword: str, page_urls: list[str], homepage: str) -> str:
    """Assign the most relevant crawled landing page for a keyword."""
    lowered = keyword.lower()
    bedroom_match = re.search(r"(\d)\s*(?:bed|bedroom)", lowered)
    best_url = ""
    best_score = 0
    for url in page_urls:
        path = urlsplit(url).path.lower()
        score = 0
        for path_hint, keyword_hints in PAGE_HINTS:
            if path_hint in path and any(hint in lowered for hint in keyword_hints):
                score += 2
        if "studio" in lowered and "studio" in path:
            score += 2
        if bedroom_match and bedroom_match.group(1) in path:
            score += 1
        # Prefer shallow hub pages over deep detail pages at equal relevance.
        depth_penalty = path.count("/") * 0.01
        if score - depth_penalty > best_score:
            best_score = score - depth_penalty
            best_url = url
    return best_url or homepage


def build_keyword_strategy(
    location: str,
    target_url: str,
    property_name: str = "",
    rankings: list[dict] | None = None,
    related: list[dict] | None = None,
    seed_metrics: dict[str, dict] | None = None,
    approved_targets: list[dict] | None = None,
    property_terms: list[str] | None = None,
    excluded_terms: list[str] | None = None,
    competitor_terms: list[str] | None = None,
    vertical: str = "multifamily",
    secondary_locations: list[str] | None = None,
    page_urls: list[str] | None = None,
    max_keywords: int = 60,
) -> list[dict]:
    """Merge sources into scored, page-assigned keyword candidates."""

    homepage = target_url
    pages = page_urls or []
    hostname = urlsplit(target_url).hostname or ""
    brand_tokens = {
        token
        for token in re.findall(r"[a-z0-9]+", f"{hostname} {property_name}".lower())
        if token not in {"www", "com", "net", "org", "apartments", "the"}
        and len(token) > 2
    }
    all_locations = [location, *(secondary_locations or [])]
    location_phrases = tuple(
        value.split(",", 1)[0].strip().lower()
        for value in all_locations
        if value.strip()
    )
    location_tokens = {
        token
        for value in all_locations
        for token in re.findall(r"[a-z0-9]+", value.lower())
        if len(token) > 2
    }
    # A city can also appear in the property name or domain. It must still be
    # validated as a location phrase so lookalike markets such as Walnut Creek
    # cannot pass through the brand-token shortcut.
    brand_tokens -= location_tokens
    primary_brand_tokens = _primary_brand_tokens(property_name) - location_tokens
    location_suffix_tokens = {
        token
        for value in all_locations
        for token in re.findall(r"[a-z0-9]+", value.lower())
        if token not in {
            part
            for phrase in location_phrases
            for part in phrase.split()
        }
    }

    merged: dict[str, KeywordCandidate] = {}
    property_term_source = (
        VERTICAL_MARKERS.get(vertical, HOUSING_MARKERS)
        if property_terms is None
        else property_terms
    )
    required_property_terms = {
        token
        for value in property_term_source
        for token in re.findall(r"[a-z0-9]+", value.lower())
        if len(token) > 2
    }
    excluded_phrases = tuple(
        " ".join(value.lower().split())
        for value in (excluded_terms or [])
        if value.strip()
    )
    competitor_phrases = tuple(
        " ".join(value.lower().split())
        for value in (competitor_terms or [])
        if value.strip()
    )
    normalized_seed_metrics = {
        key.strip().lower(): value
        for key, value in (seed_metrics or {}).items()
    }

    for row in approved_targets or []:
        keyword = (row.get("keyword") or "").strip().lower()
        if (
            not keyword
            or any(phrase and phrase in keyword for phrase in excluded_phrases)
            or any(phrase and phrase in keyword for phrase in competitor_phrases)
        ):
            continue
        metrics = row.get("metrics") or {}
        merged[keyword] = KeywordCandidate(
            keyword=keyword,
            source="approved",
            volume=int(metrics.get("volume") or 0),
            cpc=float(metrics.get("cpc") or 0),
            difficulty=float(metrics.get("difficulty") or metrics.get("kd") or 0),
            competition=float(metrics.get("competition") or 0),
            assigned_page=row.get("canonical_url") or homepage,
            evidence={"approved_target": True, "role": row.get("role") or "primary"},
        )

    for row in rankings or []:
        keyword = (row.get("keyword") or "").strip().lower()
        if (
            not keyword
            or keyword in merged
            or not is_relevant_keyword(
                keyword,
                location_tokens,
                brand_tokens,
                required_property_terms,
                excluded_phrases,
                competitor_phrases,
                location_phrases,
                location_suffix_tokens,
                primary_brand_tokens,
            )
        ):
            continue
        merged[keyword] = KeywordCandidate(
            keyword=keyword,
            source="ranking",
            volume=int(row.get("volume") or 0),
            cpc=float(row.get("cpc") or 0),
            difficulty=float(row.get("difficulty") or 0),
            competition=float(row.get("competition") or 0),
            position=int(row.get("position")) if row.get("position") else None,
            landing_page=row.get("landing_page") or "",
            evidence={"semrush_report": "domain_organic"},
        )

    for row in related or []:
        keyword = (row.get("keyword") or "").strip().lower()
        if (
            not keyword
            or keyword in merged
            or not is_relevant_keyword(
                keyword,
                location_tokens,
                brand_tokens,
                required_property_terms,
                excluded_phrases,
                competitor_phrases,
                location_phrases,
                location_suffix_tokens,
                primary_brand_tokens,
            )
        ):
            continue
        merged[keyword] = KeywordCandidate(
            keyword=keyword,
            source="related",
            volume=int(row.get("volume") or 0),
            cpc=float(row.get("cpc") or 0),
            difficulty=float(row.get("difficulty") or 0),
            competition=float(row.get("competition") or 0),
            evidence={"semrush_report": "phrase_related"},
        )

    strategy_seeds = [
        phrase
        for market in all_locations
        for phrase in seed_phrases(market, property_name, vertical)
    ]
    for phrase in dict.fromkeys(strategy_seeds):
        keyword = phrase.strip().lower()
        if (
            keyword
            and keyword not in merged
            and is_relevant_keyword(
                keyword,
                location_tokens,
                brand_tokens,
                required_property_terms,
                excluded_phrases,
                competitor_phrases,
                location_phrases,
                location_suffix_tokens,
                primary_brand_tokens,
            )
        ):
            metrics = normalized_seed_metrics.get(keyword, {})
            merged[keyword] = KeywordCandidate(
                keyword=keyword,
                source="seed",
                volume=int(metrics.get("volume") or 0),
                difficulty=float(
                    metrics.get("difficulty") or metrics.get("kd") or 0
                ),
                evidence={
                    "seed": "location-template",
                    **(
                        {"semrush_report": "phrase_this"}
                        if metrics
                        else {}
                    ),
                },
            )

    candidates = list(merged.values())
    for candidate in candidates:
        candidate.intent = classify_intent(candidate.keyword, brand_tokens, vertical)
        if candidate.source == "approved":
            candidate.score = 100.0
        else:
            candidate.score = score_candidate(candidate, location_tokens)
            candidate.assigned_page = (
                candidate.landing_page
                if candidate.landing_page
                else assign_page(candidate.keyword, pages, homepage)
            )

    candidates.sort(
        key=lambda item: (item.source == "approved", item.score, item.volume),
        reverse=True,
    )
    return [candidate.to_dict() for candidate in candidates[:max_keywords]]
