"""Optional Semrush, AI, performance, and accessibility enrichment."""

from __future__ import annotations

import csv
from pathlib import Path
from urllib.parse import urlsplit

from modules.agent import SEOAgent
from modules.pagespeed import PageSpeedClient
from modules.semrush import SemrushClient
from modules.url_safety import UnsafeAuditUrl, validate_public_audit_url
from worker.repository import AuditJob


class InsightRunner:
    def __init__(
        self,
        semrush: SemrushClient | None = None,
        agent: SEOAgent | None = None,
        pagespeed: PageSpeedClient | None = None,
    ):
        self.semrush = semrush or SemrushClient()
        self.agent = agent or SEOAgent()
        self.pagespeed = pagespeed or PageSpeedClient()

    def run(self, job: AuditJob, crawl_dir: Path) -> dict:
        pages = _load_representative_pages(crawl_dir / "internal_all.csv", limit=5)
        keywords = _target_keywords(job.location)
        result = {
            "semrush": {},
            "keyword_metrics": {},
            "content_recommendations": [],
            "page_experience": [],
            "enrichment_errors": [],
        }

        try:
            domain = urlsplit(job.target_url).hostname or ""
            result["semrush"] = self.semrush.get_domain_overview(domain)
            result["keyword_metrics"] = self.semrush.get_keyword_data(keywords)
        except Exception as exc:
            result["enrichment_errors"].append(_safe_error("semrush", exc))

        for page in pages:
            try:
                metadata = self.agent.optimize_metadata(
                    {
                        "url": page["url"],
                        "current_title": page["title"],
                        "keywords": keywords,
                    }
                )
                onpage = self.agent.optimize_onpage(
                    {
                        "url": page["url"],
                        "current_h1": page["h1"],
                        "current_content": page["meta_description"],
                        "target_keyword": keywords[0],
                    }
                )
                result["content_recommendations"].append(
                    {
                        **page,
                        "target_keywords": keywords,
                        "proposed_title": metadata.get("title", ""),
                        "proposed_meta_description": metadata.get(
                            "meta_description", ""
                        ),
                        "proposed_h1": onpage.get("h1", ""),
                        "proposed_content": onpage.get("content", ""),
                        "requires_human_review": True,
                    }
                )
            except Exception as exc:
                result["enrichment_errors"].append(_safe_error("anthropic", exc))

        if job.run_performance or job.run_accessibility:
            for page in pages[:3] or [{"url": job.target_url}]:
                try:
                    page_result = self.pagespeed.analyze_url(page["url"])
                    if not job.run_performance:
                        page_result.pop("performance_score", None)
                        page_result.pop("metrics", None)
                    if not job.run_accessibility:
                        page_result.pop("accessibility_score", None)
                        page_result.pop("accessibility_issues", None)
                    result["page_experience"].append(page_result)
                except Exception as exc:
                    result["enrichment_errors"].append(_safe_error("pagespeed", exc))

        return result


def _target_keywords(location: str) -> list[str]:
    return [
        f"apartments in {location}",
        f"pet friendly apartments {location}",
        f"luxury apartments {location}",
        f"studio apartments {location}",
    ]


def _load_representative_pages(path: Path, limit: int) -> list[dict[str, str]]:
    if not path.is_file():
        return []

    pages = []
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            url = (row.get("Address") or "").strip()
            content_type = (row.get("Content Type") or "").lower()
            status = str(row.get("Status Code") or "").strip()
            if not url or status not in {"", "200", "200.0"}:
                continue
            if content_type and "html" not in content_type:
                continue
            try:
                url = validate_public_audit_url(url)
            except UnsafeAuditUrl:
                continue
            pages.append(
                {
                    "url": url,
                    "title": _clean(row.get("Title 1")),
                    "h1": _clean(row.get("H1-1")),
                    "meta_description": _clean(row.get("Meta Description 1")),
                }
            )
            if len(pages) >= limit:
                break
    return pages


def _clean(value) -> str:
    return str(value).strip() if value is not None else ""


def _safe_error(service: str, exc: Exception) -> dict[str, str]:
    return {
        "service": service,
        "message": str(exc)[:500] or exc.__class__.__name__,
    }
