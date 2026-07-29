"""PageSpeed Insights client for performance and accessibility audit data."""

from __future__ import annotations

import os
from typing import Any, Iterable

import requests


class PageSpeedError(RuntimeError):
    """Raised when PageSpeed Insights cannot produce a usable result."""


class PageSpeedClient:
    BASE_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"

    def __init__(
        self,
        api_key: str | None = None,
        timeout: int = 90,
        session: requests.Session | None = None,
    ):
        self.api_key = api_key or os.getenv("PAGESPEED_API_KEY")
        self.timeout = timeout
        self.session = session or requests.Session()

    def analyze_url(self, url: str, strategy: str = "mobile") -> dict[str, Any]:
        if strategy not in {"mobile", "desktop"}:
            raise ValueError("strategy must be 'mobile' or 'desktop'")

        params: list[tuple[str, str]] = [
            ("url", url),
            ("strategy", strategy),
            ("category", "performance"),
            ("category", "accessibility"),
        ]
        if self.api_key:
            params.append(("key", self.api_key))

        try:
            response = self.session.get(self.BASE_URL, params=params, timeout=self.timeout)
            response.raise_for_status()
            payload = response.json()
        except requests.RequestException as exc:
            response = getattr(exc, "response", None)
            status = f"HTTP {response.status_code}" if response is not None else exc.__class__.__name__
            detail = ""
            if response is not None:
                try:
                    body = response.json()
                    detail = str(body.get("error", {}).get("message", ""))
                except (ValueError, AttributeError):
                    detail = response.text[:300]
            message = f"PageSpeed request failed for {url}: {status}"
            if detail:
                message += f" — {detail[:300]}"
            raise PageSpeedError(message) from exc
        except ValueError as exc:
            raise PageSpeedError(f"PageSpeed returned invalid JSON for {url}") from exc

        lighthouse = payload.get("lighthouseResult")
        if not isinstance(lighthouse, dict):
            raise PageSpeedError(f"PageSpeed returned no Lighthouse result for {url}")

        categories = lighthouse.get("categories", {})
        audits = lighthouse.get("audits", {})

        def score(category: str) -> int | None:
            value = categories.get(category, {}).get("score")
            return round(value * 100) if isinstance(value, (int, float)) else None

        metrics = {}
        for key, label in {
            "first-contentful-paint": "first_contentful_paint",
            "largest-contentful-paint": "largest_contentful_paint",
            "total-blocking-time": "total_blocking_time",
            "cumulative-layout-shift": "cumulative_layout_shift",
            "speed-index": "speed_index",
        }.items():
            audit = audits.get(key, {})
            metrics[label] = {
                "display_value": audit.get("displayValue"),
                "numeric_value": audit.get("numericValue"),
                "score": audit.get("score"),
            }

        accessibility_issues = []
        accessibility_refs = categories.get("accessibility", {}).get("auditRefs", [])
        for ref in accessibility_refs:
            audit = audits.get(ref.get("id"), {})
            audit_score = audit.get("score")
            if audit.get("scoreDisplayMode") == "notApplicable" or audit_score in (1, None):
                continue
            accessibility_issues.append(
                {
                    "id": ref.get("id"),
                    "title": audit.get("title"),
                    "description": audit.get("description"),
                    "score": audit_score,
                    "details": audit.get("details", {}),
                }
            )

        return {
            "url": url,
            "strategy": strategy,
            "fetch_time": lighthouse.get("fetchTime"),
            "final_url": lighthouse.get("finalDisplayedUrl", url),
            "performance_score": score("performance"),
            "accessibility_score": score("accessibility"),
            "metrics": metrics,
            "accessibility_issues": accessibility_issues,
        }

    def analyze_urls(
        self,
        urls: Iterable[str],
        strategy: str = "mobile",
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        if limit < 1:
            raise ValueError("limit must be at least 1")

        results = []
        seen = set()
        for url in urls:
            if not url or url in seen:
                continue
            seen.add(url)
            results.append(self.analyze_url(url, strategy=strategy))
            if len(results) >= limit:
                break
        return results
