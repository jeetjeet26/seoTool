"""Processing for standalone tool runs claimed from the tool queue.

Each handler turns a queued run's options into reviewable `tool_run_items`.
Items always separate machine output (`output`) from staff edits and explicit
approval, which happen later in the web app.
"""

from __future__ import annotations

import hashlib
import io
import logging
from urllib.parse import urlsplit

from modules.content_generation import ContentGenerator
from modules.keyword_strategy import build_keyword_strategy, seed_phrases
from modules.llms_txt import generate_llms_txt, validate_llms_txt
from modules.page_metadata import fetch_page_metadata
from modules.schema_generator import (
    build_apartment_community,
    to_script_tag,
    validate_apartment_community,
)
from modules.semrush import SemrushClient
from modules.site_inventory import fetch_sitemap_urls
from worker.export_profiles import (
    SeopressTemplateError,
    merge_seopress_template,
)
from worker.tool_repository import ToolRepository, ToolRunItem, ToolRunJob

LOGGER = logging.getLogger("seo_tool_worker")

MAX_FETCH_PAGES = 200

LOCAL_AUDIT_PLATFORMS = (
    "Google Business Profile",
    "Google Maps",
    "Bing Maps",
    "Apple Maps",
    "Offsite / NAP directories",
)
LOCAL_AUDIT_FIELDS = ("Name", "Address", "Phone number", "Website URL", "Map marker")


class ToolRunner:
    def __init__(
        self,
        repository: ToolRepository,
        artifacts,
        semrush: SemrushClient | None = None,
        generator: ContentGenerator | None = None,
    ):
        self.repository = repository
        self.artifacts = artifacts
        self.semrush = semrush or SemrushClient()
        self.generator = generator or ContentGenerator()

    def process(self, run: ToolRunJob) -> None:
        handlers = {
            "keyword_research": self._keyword_research,
            "bulk_metadata": self._bulk_metadata,
            "one_off_metadata": self._one_off_metadata,
            "schema_generation": self._schema_generation,
            "llms_txt": self._llms_txt,
            "local_audit": self._local_audit,
            "listing_optimization": self._listing_optimization,
        }
        handler = handlers.get(run.tool_type)
        if handler is None:
            self.repository.fail_run(run.id, f"Unsupported tool type: {run.tool_type}")
            return
        try:
            summary = handler(run)
            self.repository.complete_run(run.id, summary or {})
        except Exception as exc:  # noqa: BLE001 - failure must reach the run row
            LOGGER.exception("Tool run failed", extra={"run_id": run.id})
            self.repository.fail_run(run.id, str(exc))

    # ------------------------------------------------------------------

    def _keyword_research(self, run: ToolRunJob) -> dict:
        options = run.options
        target_url = str(options.get("target_url") or "").strip()
        location = str(options.get("location") or "").strip()
        if not target_url or not location:
            raise ValueError("target_url and location are required")
        client = self.repository.get_client_context(run.client_id)
        property_name = str(options.get("property_name") or client.get("name") or "")

        self.repository.record_progress(run.id, "research", 10, "Pulling Semrush data")
        domain = urlsplit(target_url).hostname or ""
        rankings = self.semrush.get_organic_positions(domain)
        competitors = self.semrush.get_competitors(domain)
        backlinks = self.semrush.get_backlinks_overview(domain)

        related: list[dict] = []
        for phrase in seed_phrases(location, property_name)[:4]:
            related.extend(self.semrush.get_keyword_ideas(phrase, limit=20))

        self.repository.record_progress(run.id, "sitemap", 55, "Mapping landing pages")
        page_urls: list[str] = []
        try:
            page_urls = fetch_sitemap_urls(target_url, max_urls=500)
        except Exception:  # noqa: BLE001 - keyword runs work without a sitemap
            pass

        self.repository.record_progress(run.id, "scoring", 75, "Scoring keywords")
        candidates = build_keyword_strategy(
            location=location,
            target_url=target_url,
            property_name=property_name,
            rankings=rankings,
            related=related,
            page_urls=page_urls,
            max_keywords=int(options.get("max_keywords") or 60),
        )
        items = [
            ToolRunItem(
                item_type="keyword",
                stable_key=candidate["keyword"],
                position=position,
                input={"source": candidate["source"], "evidence": candidate["evidence"]},
                output=candidate,
            )
            for position, candidate in enumerate(candidates)
        ]
        self.repository.replace_items(run.id, items)
        return {
            "keyword_count": len(items),
            "ranked_count": sum(1 for c in candidates if c.get("position")),
            "competitors": competitors[:10],
            "backlinks": backlinks,
            "landing_page_count": len(page_urls),
        }

    # ------------------------------------------------------------------

    def _bulk_metadata(self, run: ToolRunJob) -> dict:
        options = run.options
        target_url = str(options.get("target_url") or "").strip()
        mode = str(options.get("mode") or "existing")
        keywords = [str(k).strip() for k in options.get("keywords") or [] if str(k).strip()]
        client = self.repository.get_client_context(run.client_id)

        pages = self._collect_pages(run, target_url, mode, options)
        if not pages:
            raise ValueError("No pages could be collected for metadata generation")
        for page in pages:
            page.setdefault("keywords", keywords)

        total = len(pages)
        self.repository.record_progress(
            run.id, "generation", 30, f"Generating metadata for {total} pages"
        )

        def on_progress(done: int, total_pages: int) -> None:
            progress = 30 + int(60 * done / max(1, total_pages))
            self.repository.record_progress(
                run.id, "generation", progress, f"Generated {done}/{total_pages} pages"
            )

        results = self.generator.generate_bulk_metadata(
            pages,
            mode=mode,
            client_context=_generation_context(client),
            on_progress=on_progress,
        )
        items = [
            ToolRunItem(
                item_type="metadata",
                stable_key=result["url"],
                position=position,
                input={
                    "url": result["url"],
                    "keywords": result["keywords"],
                    "current_title": result["current_title"],
                    "current_meta_description": result["current_meta_description"],
                    "current_h1": result["current_h1"],
                    "mode": mode,
                },
                output=result,
            )
            for position, result in enumerate(results)
        ]
        self.repository.replace_items(run.id, items)
        failed = sum(1 for result in results if result.get("error"))
        return {
            "page_count": total,
            "generated_count": total - failed,
            "failed_count": failed,
            "mode": mode,
        }

    def _collect_pages(
        self, run: ToolRunJob, target_url: str, mode: str, options: dict
    ) -> list[dict]:
        """Pages come from an uploaded SEOPress template, an explicit URL list,
        or sitemap discovery. Live-site runs fetch current metadata per page."""

        template_path = self.repository.get_input_artifact(run.id, "seopress-template")
        if template_path:
            self.repository.record_progress(
                run.id, "template", 10, "Reading uploaded template"
            )
            content = self.artifacts.download(template_path)
            return _pages_from_template(content)

        explicit_urls = [
            str(url).strip() for url in options.get("urls") or [] if str(url).strip()
        ]
        if explicit_urls:
            urls = explicit_urls
        else:
            if not target_url:
                raise ValueError("target_url is required without an uploaded template")
            self.repository.record_progress(
                run.id, "sitemap", 10, "Discovering pages from the sitemap"
            )
            urls = fetch_sitemap_urls(target_url, max_urls=MAX_FETCH_PAGES)
        urls = urls[:MAX_FETCH_PAGES]

        pages = []
        if mode == "development":
            pages = [{"url": url} for url in urls]
        else:
            self.repository.record_progress(
                run.id, "fetch", 15, f"Fetching current metadata for {len(urls)} pages"
            )
            for url in urls:
                try:
                    pages.append(fetch_page_metadata(url))
                except Exception:  # noqa: BLE001 - skip unreachable pages
                    pages.append({"url": url})
        return pages

    # ------------------------------------------------------------------

    def _one_off_metadata(self, run: ToolRunJob) -> dict:
        options = run.options
        url = str(options.get("url") or "").strip()
        if not url:
            raise ValueError("url is required")
        keywords = [str(k).strip() for k in options.get("keywords") or [] if str(k).strip()]
        client = self.repository.get_client_context(run.client_id)

        current = {"title": "", "meta_description": "", "h1": ""}
        if options.get("fetch_current", True):
            self.repository.record_progress(run.id, "fetch", 20, "Fetching the page")
            try:
                current = fetch_page_metadata(url)
            except Exception:  # noqa: BLE001 - manual context still works
                pass

        self.repository.record_progress(run.id, "generation", 50, "Writing metadata")
        result = self.generator.generate_one_off(
            url=url,
            keywords=keywords,
            current_title=str(options.get("current_title") or current.get("title") or ""),
            current_meta_description=str(
                options.get("current_meta_description")
                or current.get("meta_description")
                or ""
            ),
            current_h1=str(options.get("current_h1") or current.get("h1") or ""),
            page_context=str(options.get("page_context") or ""),
            client_context=_generation_context(client),
        )
        self.repository.replace_items(
            run.id,
            [
                ToolRunItem(
                    item_type="metadata",
                    stable_key=url,
                    position=0,
                    input={"url": url, "keywords": keywords},
                    output=result,
                )
            ],
        )
        return {"page_count": 1, "url": url}

    # ------------------------------------------------------------------

    def _schema_generation(self, run: ToolRunJob) -> dict:
        facts = dict(run.options.get("facts") or {})
        problems = validate_apartment_community(facts)
        output: dict = {"problems": problems}
        if not problems:
            document = build_apartment_community(facts)
            output["document"] = document
            output["script_tag"] = to_script_tag(document)
        self.repository.replace_items(
            run.id,
            [
                ToolRunItem(
                    item_type="schema",
                    stable_key=str(facts.get("url") or run.id),
                    position=0,
                    input={"facts": facts},
                    output=output,
                )
            ],
        )
        return {
            "valid": not problems,
            "problem_count": len(problems),
            "floor_plan_count": len(facts.get("floor_plans") or []),
        }

    # ------------------------------------------------------------------

    def _llms_txt(self, run: ToolRunJob) -> dict:
        options = run.options
        target_url = str(options.get("target_url") or "").strip()
        if not target_url:
            raise ValueError("target_url is required")
        client = self.repository.get_client_context(run.client_id)
        site_name = str(options.get("site_name") or client.get("name") or "")
        description = str(options.get("description") or "")

        self.repository.record_progress(run.id, "sitemap", 15, "Discovering pages")
        urls = fetch_sitemap_urls(target_url, max_urls=100)

        self.repository.record_progress(run.id, "fetch", 40, "Reading page metadata")
        pages = []
        for url in urls[:MAX_FETCH_PAGES]:
            try:
                pages.append(fetch_page_metadata(url))
            except Exception:  # noqa: BLE001
                pages.append({"url": url})

        content = generate_llms_txt(site_name, target_url, description, pages)
        problems = validate_llms_txt(content)
        self.repository.replace_items(
            run.id,
            [
                ToolRunItem(
                    item_type="llms_txt",
                    stable_key=target_url,
                    position=0,
                    input={"target_url": target_url, "page_count": len(pages)},
                    output={"content": content, "problems": problems},
                )
            ],
        )
        return {"page_count": len(pages), "problem_count": len(problems)}

    # ------------------------------------------------------------------

    def _local_audit(self, run: ToolRunJob) -> dict:
        """Seed the staff-verifiable local listing checklist."""
        client = self.repository.get_client_context(run.client_id)
        items = []
        position = 0
        for platform in LOCAL_AUDIT_PLATFORMS:
            for field in LOCAL_AUDIT_FIELDS:
                items.append(
                    ToolRunItem(
                        item_type="local_check",
                        stable_key=f"{platform}::{field}",
                        position=position,
                        input={
                            "platform": platform,
                            "field": field,
                            "expected": client.get("intake", {}).get("nap", {}),
                        },
                        output={
                            "platform": platform,
                            "field": field,
                            "result": "unchecked",
                            "notes": "",
                            "evidence_url": "",
                        },
                    )
                )
                position += 1
        self.repository.replace_items(run.id, items)
        return {"check_count": len(items), "platforms": list(LOCAL_AUDIT_PLATFORMS)}

    # ------------------------------------------------------------------

    def _listing_optimization(self, run: ToolRunJob) -> dict:
        options = run.options
        listing_url = str(options.get("listing_url") or "").strip()
        original_copy = str(options.get("original_copy") or "").strip()
        keywords = [str(k).strip() for k in options.get("keywords") or [] if str(k).strip()]
        if not listing_url:
            raise ValueError("listing_url is required")
        client = self.repository.get_client_context(run.client_id)

        if not original_copy:
            self.repository.record_progress(run.id, "fetch", 20, "Fetching the listing")
            try:
                fetched = fetch_page_metadata(listing_url)
                original_copy = fetched.get("meta_description") or fetched.get("title") or ""
            except Exception:  # noqa: BLE001
                pass

        self.repository.record_progress(run.id, "generation", 50, "Rewriting listing copy")
        result = self.generator.generate_one_off(
            url=listing_url,
            keywords=keywords,
            page_context=original_copy,
            client_context=_generation_context(client),
        )
        self.repository.replace_items(
            run.id,
            [
                ToolRunItem(
                    item_type="listing",
                    stable_key=listing_url,
                    position=0,
                    input={
                        "listing_url": listing_url,
                        "keywords": keywords,
                        "original_copy": original_copy,
                    },
                    output={
                        "original_copy": original_copy,
                        "proposed_copy": result.get("proposed_content")
                        or result.get("proposed_meta_description", ""),
                        "proposed_title": result.get("proposed_title", ""),
                        "rationale": result.get("rationale", ""),
                    },
                )
            ],
        )
        return {"listing_url": listing_url}


def _generation_context(client: dict) -> dict:
    intake = client.get("intake") or {}
    return {
        "name": client.get("name", ""),
        "differentiators": intake.get("differentiators", ""),
        "amenities": intake.get("amenities", ""),
        "avoided_terms": intake.get("avoided_terms", ""),
    }


def _pages_from_template(content: bytes) -> list[dict]:
    """Rows from an uploaded SEOPress template become generation inputs."""
    import csv as _csv

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise SeopressTemplateError("The template must be UTF-8 encoded") from exc
    reader = _csv.DictReader(io.StringIO(text))
    pages = []
    for row in reader:
        normalized = {
            (key or "").strip().lower(): (value or "").strip()
            for key, value in row.items()
        }
        url = (
            normalized.get("url")
            or normalized.get("permalink")
            or normalized.get("address")
            or normalized.get("page url")
        )
        if not url:
            continue
        pages.append(
            {
                "url": url,
                "title": normalized.get("seopress_titles_title")
                or normalized.get("meta title")
                or normalized.get("title", ""),
                "meta_description": normalized.get("seopress_titles_desc")
                or normalized.get("meta description")
                or normalized.get("description", ""),
            }
        )
    return pages


def approved_metadata_by_url(items: list[dict]) -> dict[str, dict[str, str]]:
    """Map approved item payloads (edited over raw) keyed by URL for exports."""
    result: dict[str, dict[str, str]] = {}
    for item in items:
        if item.get("review_status") != "approved":
            continue
        payload = {**(item.get("output") or {}), **(item.get("edited_output") or {})}
        url = str(payload.get("url") or item.get("stable_key") or "").strip()
        if not url:
            continue
        result[url] = {
            "title": str(payload.get("proposed_title") or payload.get("title") or ""),
            "meta_description": str(
                payload.get("proposed_meta_description")
                or payload.get("meta_description")
                or ""
            ),
        }
    return result


def stable_key_for(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


__all__ = [
    "ToolRunner",
    "approved_metadata_by_url",
    "merge_seopress_template",
]
