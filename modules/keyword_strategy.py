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

TRANSACTIONAL_MARKERS = (
    "for rent",
    "rent ",
    " rentals",
    "specials",
    "tour",
    "apply",
    "availability",
    "move in",
)
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
    source: str  # ranking | seed | related
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


def seed_phrases(location: str, property_name: str = "") -> list[str]:
    """Location seed phrases used to pull related-keyword ideas."""
    # Semrush has substantially better exact-keyword coverage for city-level
    # phrases than long-form values such as "Long Beach, California".
    location = location.split(",", 1)[0].strip()
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


def classify_intent(keyword: str, brand_tokens: set[str]) -> str:
    """Heuristic search-intent codes matching the report convention.

    navigational (brand), transactional, informational, or commercial.
    """
    lowered = f" {keyword.lower()} "
    tokens = set(re.findall(r"[a-z0-9]+", lowered))
    if brand_tokens and brand_tokens & tokens:
        return "navigational"
    if any(marker in lowered for marker in TRANSACTIONAL_MARKERS):
        return "transactional"
    if any(lowered.strip().startswith(marker) for marker in INFORMATIONAL_MARKERS):
        return "informational"
    return "commercial"


def is_relevant_keyword(
    keyword: str,
    location_tokens: set[str],
    brand_tokens: set[str],
) -> bool:
    """Require housing intent plus a location or property-brand signal."""
    tokens = set(re.findall(r"[a-z0-9]+", keyword.lower()))
    has_housing_intent = bool(tokens & set(HOUSING_MARKERS))
    has_market_signal = bool(tokens & location_tokens) or bool(tokens & brand_tokens)
    return has_housing_intent and has_market_signal


def score_candidate(candidate: KeywordCandidate, location_tokens: set[str]) -> float:
    """0-100 score blending volume, difficulty, ranking opportunity, locality."""
    volume_points = min(40.0, (candidate.volume or 0) ** 0.5 * 4)
    difficulty_points = max(0.0, 25.0 - (candidate.difficulty or 0) * 0.25)
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
    location_tokens = {
        token
        for token in re.findall(r"[a-z0-9]+", location.lower())
        if len(token) > 2
    }

    merged: dict[str, KeywordCandidate] = {}
    normalized_seed_metrics = {
        key.strip().lower(): value
        for key, value in (seed_metrics or {}).items()
    }

    for row in rankings or []:
        keyword = (row.get("keyword") or "").strip().lower()
        if not keyword:
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
            or not is_relevant_keyword(keyword, location_tokens, brand_tokens)
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

    for phrase in seed_phrases(location, property_name):
        keyword = phrase.strip().lower()
        if keyword and keyword not in merged:
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
        candidate.intent = classify_intent(candidate.keyword, brand_tokens)
        candidate.score = score_candidate(candidate, location_tokens)
        candidate.assigned_page = (
            candidate.landing_page
            if candidate.landing_page
            else assign_page(candidate.keyword, pages, homepage)
        )

    candidates.sort(key=lambda item: item.score, reverse=True)
    return [candidate.to_dict() for candidate in candidates[:max_keywords]]
