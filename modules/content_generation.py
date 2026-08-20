"""Chunked, resumable metadata and on-page generation for all selected pages.

Wraps `SEOAgent` so runs cover every eligible page instead of a fixed handful.
Pages are processed in chunks; a failed chunk records per-item errors and the
run continues, so one bad batch never destroys hours of prior work.

Two modes:
- ``existing``: start from crawled metadata and propose edits only where the
  current value is missing, duplicated, or off-target.
- ``development``: start from sitemap/template rows with no current values and
  generate a complete first pass (title, description, H1, on-page copy).
"""

from __future__ import annotations

import json
from difflib import SequenceMatcher
from typing import Callable, Iterable
from urllib.parse import urlsplit

from modules.agent import SEOAgent

TITLE_MAX = 60
TITLE_MIN = 50
DESCRIPTION_MIN = 130
DESCRIPTION_MAX = 155
NEW_BLOCK_MAX_WORDS = 35
DEFAULT_CHUNK_SIZE = 10
DEFAULT_P11_STYLE_GUIDE = (
    "Use approved P11 page-type patterns. Titles: maximum 60 characters; "
    "prefer one spaced hyphen separator and never stack separators. "
    "Home: [primary keyword] in [City, State] - [Brand]. "
    "Floor plans: [property or bedroom keyword] in [City, State] - [Brand]. "
    "Amenities: [property type] Amenities in [City, State] - [Brand]. "
    "Gallery: Gallery - [property type] in [City, State]. "
    "Descriptions: 130-155 characters, action-led, target keyword in the "
    "first 100 characters, and a natural CTA."
)

ProgressCallback = Callable[[int, int], None]


class ContentGenerator:
    def __init__(self, agent: SEOAgent | None = None, chunk_size: int = DEFAULT_CHUNK_SIZE):
        self.agent = agent or SEOAgent()
        self.chunk_size = max(1, chunk_size)

    # ------------------------------------------------------------------
    # Bulk metadata
    # ------------------------------------------------------------------

    def generate_bulk_metadata(
        self,
        pages: list[dict],
        mode: str = "existing",
        client_context: dict | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> list[dict]:
        """Generate title/description/H1 (and copy in development mode).

        Each page dict needs ``url`` and optional ``title``,
        ``meta_description``, ``h1``, ``keywords`` (list[str]).
        Returns one result dict per input page, in order.
        """

        results: list[dict] = []
        total = len(pages)
        for start in range(0, total, self.chunk_size):
            chunk = pages[start : start + self.chunk_size]
            chunk_results = self._generate_chunk(chunk, mode, client_context or {})
            results.extend(chunk_results)
            if on_progress:
                on_progress(min(start + self.chunk_size, total), total)
        return results

    def _generate_chunk(
        self, chunk: list[dict], mode: str, client_context: dict
    ) -> list[dict]:
        chunk = [
            {
                **page,
                "location": page.get("location") or client_context.get("location") or "",
                "brand": page.get("brand") or client_context.get("name") or "",
            }
            for page in chunk
        ]
        prompt = self._chunk_prompt(chunk, mode, client_context)
        system_prompt = (
            "You are an expert SEO copywriter. Match the site's industry, "
            "audience, evidence, approved style guide, and existing brand voice."
        )
        if client_context.get("fair_housing_enabled"):
            system_prompt += (
                "\nWhen writing about housing, apply these Fair Housing safeguards:\n"
                f"{self.agent.FAIR_HOUSING_GUIDELINES}"
            )

        parsed: list[dict] | None = None
        for attempt in range(2):
            attempt_prompt = prompt
            if attempt:
                attempt_prompt += (
                    "\n\nVALIDATION FAILURE TO CORRECT: Every page must have a "
                    "non-empty proposed title and meta description, and each must "
                    "differ materially from its current value. Return the complete "
                    "corrected JSON array."
                )
            response = self.agent._get_completion(
                system_prompt, attempt_prompt, max_tokens=6000
            )
            parsed = _parse_json_array(response)
            if parsed is not None and (
                mode != "existing"
                or _all_metadata_rewritten(parsed, chunk)
                or attempt == 1
            ):
                break
        if parsed is None:
            return [
                self._item_result(page, {}, mode, error="generation_failed")
                for page in chunk
            ]

        by_index = {entry.get("index"): entry for entry in parsed if isinstance(entry, dict)}
        return [
            self._item_result(page, by_index.get(position + 1) or {}, mode)
            for position, page in enumerate(chunk)
        ]

    def _chunk_prompt(self, chunk: list[dict], mode: str, client_context: dict) -> str:
        client_context = {
            **client_context,
            "title_style_guide": (
                client_context.get("title_style_guide")
                or DEFAULT_P11_STYLE_GUIDE
            ),
        }
        lines = []
        for position, page in enumerate(chunk):
            keywords = ", ".join(page.get("keywords") or [])
            body_text = _clean(page.get("body_text"))
            body_word_count = int(page.get("body_word_count") or 0)
            rewrite_block = _clean(page.get("rewrite_block"))
            lines.append(
                f"{position + 1}. URL: {page.get('url', '')}\n"
                f"   Target keywords: {keywords or 'infer from URL'}\n"
                f"   Current title: {page.get('title') or 'None'}\n"
                f"   Current meta description: {page.get('meta_description') or 'None'}\n"
                f"   Current H1: {page.get('h1') or 'None'}\n"
                f"   Current visible body copy ({body_word_count} words): "
                f"{body_text or 'Unavailable'}\n"
                f"   Paragraph block eligible for a light rewrite: "
                f"{rewrite_block or 'None available'}"
            )
        pages_text = "\n".join(lines)

        context_lines = []
        for key in (
            "name",
            "location",
            "vertical",
            "differentiators",
            "amenities",
            "avoided_terms",
            "title_style_guide",
        ):
            value = client_context.get(key)
            if value:
                context_lines.append(f"- {key.replace('_', ' ').title()}: {value}")
        context_text = "\n".join(context_lines) or "- None provided"

        if mode == "development":
            task = (
                "These pages belong to a new or in-development property website. "
                "Generate a complete first pass for every page: title, "
                "meta description, H1, and a 2-3 sentence introductory paragraph."
            )
        else:
            task = (
                "These pages belong to a live website. Write a new proposed title "
                "and a new proposed meta description for every page. Both must "
                "differ materially from the current value while following the "
                "approved style guide and assigned keyword. Propose a different H1 "
                "only where the current H1 is missing, duplicated, off-target, or "
                "violates the approved style guide; otherwise return the current H1. "
                "Analyze the supplied visible body copy for search intent, topical "
                "depth, clarity, and keyword alignment. When a paragraph block is "
                "available, return that complete paragraph with only a light edit: "
                "change no more than 3-7 words, or preserve it and append one short "
                "sentence. Do not rewrite the entire page or expand the paragraph. "
                "When no paragraph block is available or visible copy could not be "
                "fetched, propose one short new introductory paragraph of at most "
                f"{NEW_BLOCK_MAX_WORDS} words and set content_action to 'new_block'. "
                "Otherwise use 'rewrite_block' for a light paragraph "
                "edit or 'none' when no copy change is needed. "
                "Return an empty content field only when the current body copy "
                "already serves the target query well."
            )

        return f"""{task}

Rules:
- Titles must be {TITLE_MIN}-{TITLE_MAX} characters. Use as much of the {TITLE_MAX}-character limit as you can without stuffing.
- Meta descriptions must be {DESCRIPTION_MIN}-{DESCRIPTION_MAX} characters.
- Use one spaced hyphen as the preferred title separator. Never use em/en dashes, curly quotes, ellipses, or stacked separators.
- Do not introduce a keyword that is not assigned to the page.
- Keep on-page edits minimal: at most seven altered words or one short added sentence.
- Use only facts from the approved client context below. Never invent amenities, prices, or availability.
{"- All copy must follow the supplied Fair Housing safeguards." if client_context.get("fair_housing_enabled") else ""}

Approved client context (use only these facts):
{context_text}

Pages:
{pages_text}

Return ONLY a JSON array. One object per page with keys:
"index" (1-based), "title", "meta_description", "h1", "content" (may be ""),
"content_action" ("rewrite_block", "new_block", or "none"), "rationale" (one sentence).
"""

    def _item_result(
        self, page: dict, entry: dict, mode: str, error: str = ""
    ) -> dict:
        proposed_title = _clean(entry.get("title"))
        proposed_description = _clean(entry.get("meta_description"))
        current_title = _clean(page.get("title"))
        current_block = _clean(page.get("rewrite_block"))
        proposed_content = _clean(entry.get("content"))
        content_action = "none"
        content_warning = ""
        if proposed_content:
            if current_block:
                if _is_light_rewrite(current_block, proposed_content):
                    content_action = "rewrite_block"
                else:
                    proposed_content = ""
                    content_warning = "content_change_too_large"
            else:
                proposed_content, trimmed = _trim_new_block(proposed_content)
                content_action = "new_block"
                if trimmed:
                    content_warning = "new_content_block_trimmed"
        rationale = _clean(entry.get("rationale"))
        if content_action == "new_block" and "new" not in rationale.lower():
            rationale = f"New paragraph block: {rationale}".strip()
        if mode == "existing" and proposed_title == current_title:
            proposed_title = _distinct_title(current_title, page)
        proposed_title = _lengthen_title(proposed_title, page)
        result = {
            "url": page.get("url", ""),
            "mode": mode,
            "keywords": page.get("keywords") or [],
            "current_title": current_title,
            "current_meta_description": _clean(page.get("meta_description")),
            "current_h1": _clean(page.get("h1")),
            "current_body_word_count": int(page.get("body_word_count") or 0),
            "proposed_title": proposed_title,
            "proposed_meta_description": proposed_description,
            "proposed_h1": _clean(entry.get("h1")),
            "proposed_content": proposed_content,
            "content_action": content_action,
            "rationale": rationale,
            "title_length": len(proposed_title),
            "meta_description_length": len(proposed_description),
            "warnings": validate_metadata(proposed_title, proposed_description),
        }
        if content_warning:
            result["warnings"].append(content_warning)
        if result["proposed_content"]:
            result["current_body_text"] = current_block
        if error:
            result["error"] = error
        return result

    # ------------------------------------------------------------------
    # One-off writing
    # ------------------------------------------------------------------

    def generate_one_off(
        self,
        url: str,
        keywords: list[str],
        current_title: str = "",
        current_meta_description: str = "",
        current_h1: str = "",
        page_context: str = "",
        client_context: dict | None = None,
    ) -> dict:
        """Focused generation for a single URL or manually supplied context."""
        page = {
            "url": url,
            "title": current_title,
            "meta_description": current_meta_description,
            "h1": current_h1,
            "keywords": keywords,
        }
        if page_context:
            page["meta_description"] = page["meta_description"] or page_context[:300]
        results = self.generate_bulk_metadata(
            [page], mode="existing", client_context=client_context
        )
        return results[0]

    # ------------------------------------------------------------------
    # Alt text
    # ------------------------------------------------------------------

    def generate_alt_text(
        self,
        images: Iterable[dict],
        on_progress: ProgressCallback | None = None,
        fair_housing_enabled: bool = False,
    ) -> list[dict]:
        """Alt-text proposals; each image dict needs image_url and page_url."""
        items = [
            {
                "image_url": image.get("image_url", ""),
                "page_url": image.get("page_url", ""),
                "current_alt_text": image.get("alt_text", ""),
            }
            for image in images
        ]
        if not items:
            return []
        processed = self.agent.generate_alt_text_batch(
            items,
            fair_housing_enabled=fair_housing_enabled,
        )
        results = []
        total = len(processed)
        for position, item in enumerate(processed):
            proposed = _clean(item.get("suggested_fix"))
            results.append(
                {
                    "image_url": item.get("image_url", ""),
                    "page_url": item.get("page_url", ""),
                    "current_alt_text": item.get("current_alt_text", ""),
                    "proposed_alt_text": proposed,
                    "alt_text_length": len(proposed),
                    "warnings": (
                        ["alt_text_over_125"] if len(proposed) > 125 else []
                    ),
                }
            )
            if on_progress:
                on_progress(position + 1, total)
        return results


def validate_metadata(title: str, description: str) -> list[str]:
    warnings = []
    if title and len(title) > TITLE_MAX:
        warnings.append("title_over_60")
    if title and len(title) < TITLE_MIN:
        warnings.append("title_under_50")
    if description and len(description) > DESCRIPTION_MAX:
        warnings.append("description_over_155")
    if description and len(description) < DESCRIPTION_MIN:
        warnings.append("description_under_130")
    return warnings


def _parse_json_array(response: str) -> list[dict] | None:
    if not response:
        return None
    cleaned = response.replace("```json", "").replace("```", "").strip()
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, list) else None


def _all_metadata_rewritten(parsed: list[dict], pages: list[dict]) -> bool:
    by_index = {
        item.get("index"): item
        for item in parsed
        if isinstance(item, dict)
    }
    for index, page in enumerate(pages, start=1):
        item = by_index.get(index) or {}
        proposed_title = _clean(item.get("title"))
        proposed_description = _clean(item.get("meta_description"))
        if (
            not proposed_title
            or not proposed_description
            or proposed_title == _clean(page.get("title"))
            or proposed_description == _clean(page.get("meta_description"))
        ):
            return False
    return True


def _trim_new_block(text: str) -> tuple[str, bool]:
    words = text.split()
    if not words:
        return "", False
    if len(words) <= NEW_BLOCK_MAX_WORDS:
        return text, False
    trimmed = " ".join(words[:NEW_BLOCK_MAX_WORDS]).rstrip(" ,;:")
    if trimmed and trimmed[-1] not in ".!?":
        trimmed += "."
    return trimmed, True


def _is_light_rewrite(current: str, proposed: str) -> bool:
    current_words = current.split()
    proposed_words = proposed.split()
    if current_words == proposed_words:
        return False
    matcher = SequenceMatcher(
        None,
        [word.lower() for word in current_words],
        [word.lower() for word in proposed_words],
    )
    altered = 0
    for tag, left_start, left_end, right_start, right_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        altered += max(left_end - left_start, right_end - right_start)
    if altered <= 7:
        return True
    if proposed_words[: len(current_words)] == current_words:
        return len(proposed_words) - len(current_words) <= 18
    return False


def _lengthen_title(title: str, page: dict) -> str:
    if not title or len(title) >= TITLE_MIN:
        return title
    location = _clean(page.get("location"))
    keyword = _clean((page.get("keywords") or [""])[0])
    hostname = (urlsplit(str(page.get("url") or "")).hostname or "").removeprefix(
        "www."
    )
    brand = _clean(page.get("brand"))
    if not brand:
        raw_brand = hostname.split(".", 1)[0].replace("-", " ")
        brand = raw_brand.title() if " " in raw_brand else ""
    suffixes: list[str] = []
    city = location.split(",")[0].strip() if location else ""
    if city and city.lower() not in title.lower():
        suffixes.append(f" in {location}")
    if brand and brand.lower() not in title.lower():
        suffixes.append(f" - {brand}")
    candidate = title
    for suffix in suffixes:
        next_title = f"{candidate}{suffix}"
        if len(next_title) <= TITLE_MAX:
            candidate = next_title
            if len(candidate) >= TITLE_MIN:
                return candidate
    if keyword and keyword.lower() not in candidate.lower():
        next_title = f"{keyword.title()} - {candidate}"
        if TITLE_MIN <= len(next_title) <= TITLE_MAX:
            return next_title
    return candidate


def _distinct_title(current_title: str, page: dict) -> str:
    for separator in (" - ", " | ", ": "):
        parts = current_title.split(separator)
        if len(parts) == 2:
            candidate = f"{parts[1]} - {parts[0]}"
            if candidate != current_title and len(candidate) <= TITLE_MAX:
                return candidate
    keyword = _clean((page.get("keywords") or [""])[0]).title()
    hostname = (urlsplit(str(page.get("url") or "")).hostname or "").removeprefix(
        "www."
    )
    brand = hostname.split(".", 1)[0].replace("-", " ").title()
    if keyword and brand:
        candidate = f"{keyword} - {brand}"
        if len(candidate) <= TITLE_MAX:
            return candidate
    return f"{current_title[: TITLE_MAX - 9].rstrip()} - Updated"


def _clean(value) -> str:
    if value is None:
        return ""
    text = str(value)
    replacements = {
        "\ufeff": "",
        "\u2014": " - ",
        "\u2013": " - ",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2026": "...",
        "\u2192": " - ",
    }
    for source, replacement in replacements.items():
        text = text.replace(source, replacement)
    return " ".join(text.split()).strip()
