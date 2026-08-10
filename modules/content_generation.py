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
from typing import Callable, Iterable

from modules.agent import SEOAgent

TITLE_MAX = 60
DESCRIPTION_MIN = 130
DESCRIPTION_MAX = 155
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
        for _attempt in range(2):
            response = self.agent._get_completion(
                system_prompt, prompt, max_tokens=6000
            )
            parsed = _parse_json_array(response)
            if parsed is not None:
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
            lines.append(
                f"{position + 1}. URL: {page.get('url', '')}\n"
                f"   Target keywords: {keywords or 'infer from URL'}\n"
                f"   Current title: {page.get('title') or 'None'}\n"
                f"   Current meta description: {page.get('meta_description') or 'None'}\n"
                f"   Current H1: {page.get('h1') or 'None'}\n"
                f"   Current visible body copy ({body_word_count} words): "
                f"{body_text or 'Unavailable'}"
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
                "depth, clarity, and keyword alignment. Include a specific 2-3 "
                "sentence replacement or addition in the content field only when "
                "copy is thin, generic, missing, or fails to serve an approved "
                "target query. Preserve roughly 80% of the original passage and "
                "make the smallest useful keyword change. "
                "Return an empty content field only when the current body copy "
                "already serves the target query well."
            )

        return f"""{task}

Rules:
- Titles must be at most {TITLE_MAX} characters.
- Meta descriptions must be {DESCRIPTION_MIN}-{DESCRIPTION_MAX} characters.
- Use one spaced hyphen as the preferred title separator. Never use em/en dashes, curly quotes, ellipses, or stacked separators.
- Do not introduce a keyword that is not assigned to the page.
- Use only facts from the approved client context below. Never invent amenities, prices, or availability.
{"- All copy must follow the supplied Fair Housing safeguards." if client_context.get("fair_housing_enabled") else ""}

Approved client context (use only these facts):
{context_text}

Pages:
{pages_text}

Return ONLY a JSON array. One object per page with keys:
"index" (1-based), "title", "meta_description", "h1", "content" (may be ""), "rationale" (one sentence).
"""

    def _item_result(
        self, page: dict, entry: dict, mode: str, error: str = ""
    ) -> dict:
        proposed_title = _clean(entry.get("title"))
        proposed_description = _clean(entry.get("meta_description"))
        result = {
            "url": page.get("url", ""),
            "mode": mode,
            "keywords": page.get("keywords") or [],
            "current_title": _clean(page.get("title")),
            "current_meta_description": _clean(page.get("meta_description")),
            "current_h1": _clean(page.get("h1")),
            "current_body_word_count": int(page.get("body_word_count") or 0),
            "proposed_title": proposed_title,
            "proposed_meta_description": proposed_description,
            "proposed_h1": _clean(entry.get("h1")),
            "proposed_content": _clean(entry.get("content")),
            "rationale": _clean(entry.get("rationale")),
            "title_length": len(proposed_title),
            "meta_description_length": len(proposed_description),
            "warnings": validate_metadata(proposed_title, proposed_description),
        }
        if result["proposed_content"]:
            result["current_body_text"] = _clean(page.get("body_text"))
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
