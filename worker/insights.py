"""Semrush, AI, performance, and accessibility enrichment for audits.

Uses the full crawl inventory (bounded by the audit's page limit) instead of a
fixed handful of pages, and evidence-backed keyword strategy instead of
hard-coded phrases.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit

from modules.agent import SEOAgent
from modules.content_generation import ContentGenerator
from modules.keyword_strategy import build_keyword_strategy, seed_phrases
from modules.pagespeed import PageSpeedClient
from modules.semrush import SemrushClient
from modules.site_inventory import build_site_inventory
from worker.repository import AuditJob

MAX_GENERATION_PAGES = 200
MAX_ALT_TEXT_IMAGES = 100
MAX_PAGESPEED_PAGES = 3


class InsightRunner:
    def __init__(
        self,
        semrush: SemrushClient | None = None,
        agent: SEOAgent | None = None,
        pagespeed: PageSpeedClient | None = None,
        generator: ContentGenerator | None = None,
    ):
        self.semrush = semrush or SemrushClient()
        self.agent = agent or SEOAgent()
        self.pagespeed = pagespeed or PageSpeedClient()
        self.generator = generator or ContentGenerator(agent=self.agent)

    def run(self, job: AuditJob, crawl_dir: Path) -> dict:
        result = {
            "semrush": {},
            "competitors": [],
            "backlinks": {},
            "keyword_metrics": {},
            "keyword_strategy": [],
            "site_inventory": {},
            "content_recommendations": [],
            "alt_text_recommendations": [],
            "page_experience": [],
            "enrichment_errors": [],
        }

        inventory = build_site_inventory(
            crawl_dir, job.target_url, page_limit=job.page_limit
        )
        result["site_inventory"] = inventory.summary()
        pages = inventory.pages

        domain = urlsplit(job.target_url).hostname or ""
        rankings: list[dict] = []
        related: list[dict] = []
        try:
            result["semrush"] = self.semrush.get_domain_overview(domain)
            rankings = self.semrush.get_organic_positions(domain)
            result["competitors"] = self.semrush.get_competitors(domain)
            result["backlinks"] = self.semrush.get_backlinks_overview(domain)
            for phrase in seed_phrases(job.location)[:3]:
                related.extend(self.semrush.get_keyword_ideas(phrase, limit=15))
        except Exception as exc:  # noqa: BLE001
            result["enrichment_errors"].append(_safe_error("semrush", exc))
        if hasattr(self.semrush, "consume_diagnostics"):
            result["enrichment_errors"].extend(
                {
                    "service": "semrush",
                    "message": message,
                }
                for message in self.semrush.consume_diagnostics()
            )

        keywords = build_keyword_strategy(
            location=job.location,
            target_url=job.target_url,
            rankings=rankings,
            related=related,
            page_urls=[page.url for page in pages],
            max_keywords=40,
        )
        result["keyword_strategy"] = keywords
        result["keyword_metrics"] = {
            candidate["keyword"]: {
                "volume": candidate["volume"],
                "kd": candidate["difficulty"],
            }
            for candidate in keywords[:10]
        }

        keywords_by_page: dict[str, list[str]] = {}
        for candidate in keywords:
            assigned = candidate.get("assigned_page") or job.target_url
            keywords_by_page.setdefault(assigned, [])
            if len(keywords_by_page[assigned]) < 3:
                keywords_by_page[assigned].append(candidate["keyword"])
        default_keywords = [candidate["keyword"] for candidate in keywords[:3]]

        generation_pages = [
            {
                "url": page.url,
                "title": page.title,
                "meta_description": page.meta_description,
                "h1": page.h1,
                "keywords": keywords_by_page.get(page.url) or default_keywords,
            }
            for page in pages[:MAX_GENERATION_PAGES]
        ]
        if generation_pages:
            try:
                result["content_recommendations"] = [
                    {**item, "requires_human_review": True}
                    for item in self.generator.generate_bulk_metadata(
                        generation_pages, mode="existing"
                    )
                ]
            except Exception as exc:  # noqa: BLE001
                result["enrichment_errors"].append(_safe_error("anthropic", exc))

        images = [
            image.to_dict()
            for image in inventory.images_missing_alt[:MAX_ALT_TEXT_IMAGES]
        ]
        if images:
            try:
                result["alt_text_recommendations"] = self.generator.generate_alt_text(
                    images
                )
            except Exception as exc:  # noqa: BLE001
                result["enrichment_errors"].append(_safe_error("anthropic", exc))

        if job.run_performance or job.run_accessibility:
            targets = [page.url for page in pages[:MAX_PAGESPEED_PAGES]] or [
                job.target_url
            ]
            for url in targets:
                try:
                    page_result = self.pagespeed.analyze_url(url)
                    if not job.run_performance:
                        page_result.pop("performance_score", None)
                        page_result.pop("metrics", None)
                    if not job.run_accessibility:
                        page_result.pop("accessibility_score", None)
                        page_result.pop("accessibility_issues", None)
                    result["page_experience"].append(page_result)
                except Exception as exc:  # noqa: BLE001
                    result["enrichment_errors"].append(_safe_error("pagespeed", exc))

        return result


def _safe_error(service: str, exc: Exception) -> dict[str, str]:
    return {
        "service": service,
        "message": str(exc)[:500] or exc.__class__.__name__,
    }
