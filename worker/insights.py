"""Semrush, AI, performance, and accessibility enrichment for audits.

Uses the full crawl inventory (bounded by the audit's page limit) instead of a
fixed handful of pages, and evidence-backed keyword strategy instead of
hard-coded phrases.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

from modules.agent import SEOAgent
from modules.content_generation import ContentGenerator
from modules.http_inventory import build_http_inventory
from modules.keyword_strategy import build_keyword_strategy, seed_phrases
from modules.models import Finding, Severity
from modules.page_content import fetch_body_copy_for_pages
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
            "semrush_site_audit": {},
            "competitors": [],
            "backlinks": {},
            "keyword_metrics": {},
            "keyword_strategy": [],
            "site_inventory": {},
            "crawl_coverage": {},
            "body_copy_coverage": {},
            "content_recommendations": [],
            "alt_text_recommendations": [],
            "page_experience": [],
            "enrichment_errors": [],
        }

        inventory = build_site_inventory(
            crawl_dir, job.target_url, page_limit=job.page_limit
        )
        if not inventory.pages:
            fallback = build_http_inventory(
                job.target_url,
                crawl_dir,
                job.page_limit,
            )
            inventory = build_site_inventory(
                crawl_dir,
                job.target_url,
                page_limit=job.page_limit,
            )
            inventory.images_missing_alt = []
            result["crawl_coverage"] = {
                "mode": "browser_http_fallback",
                "screaming_frog": "blocked",
                **fallback,
            }
            result["enrichment_errors"].append(
                {
                    "service": "screaming_frog",
                    "message": (
                        "Screaming Frog was blocked by the target site. "
                        f"Browser-style fallback analyzed {len(inventory.pages)} pages; "
                        "Semrush supplies technical issue evidence."
                    ),
                }
            )
        else:
            result["crawl_coverage"] = {
                "mode": (
                    "screaming_frog_import"
                    if job.options.get("crawl_import_paths")
                    else "screaming_frog"
                ),
                "screaming_frog": "complete",
                "pages": len(inventory.pages),
            }
        result["site_inventory"] = inventory.summary()
        pages = inventory.pages
        intake = job.client_intake
        property_name = (
            str(intake.get("property_name") or "").strip()
            or job.client_name
        )
        vertical = str(
            job.options.get("community_type")
            or intake.get("vertical")
            or "multifamily"
        )
        if vertical == "senior_housing":
            vertical = "senior_living"
        target_markets = _list_values(intake.get("target_markets"))
        secondary_market = str(
            job.options.get("secondary_market") or ""
        ).strip()
        secondary_locations = (
            [
                ", ".join(
                    value
                    for value in (secondary_market, job.target_region)
                    if value
                )
            ]
            if secondary_market
            else []
        )
        excluded_terms = _list_values(intake.get("avoided_terms"))
        competitor_terms = _competitor_terms(
            [
                *job.options.get("competitor_domains", []),
                *_list_values(intake.get("competitors")),
            ]
        )
        result["property_context"] = {
            "name": property_name,
            "location": job.location,
            "secondary_market": secondary_market,
            "vertical": vertical,
            "address": (intake.get("nap") or {}).get("address", ""),
            "website": job.target_url,
        }
        result["report_variant"] = job.options.get("report_variant", "full_client")
        result["fair_housing_enabled"] = bool(
            intake.get("fair_housing_enabled", False)
        )

        domain = urlsplit(job.target_url).hostname or ""
        rankings: list[dict] = []
        related: list[dict] = []
        seed_metrics: dict[str, dict] = {}
        try:
            result["semrush"] = self.semrush.get_domain_overview(domain)
            rankings = self.semrush.get_organic_positions(domain)
            discovered_competitors = self.semrush.get_competitors(domain)
            result["competitors"] = _merge_competitors(
                self.semrush,
                discovered_competitors,
                job.options.get("competitor_domains") or [],
            )
            result["backlinks"] = self.semrush.get_backlinks_overview(domain)
            site_audit = self.semrush.get_site_audit(
                job.target_url,
                str(intake.get("semrush_project_id") or ""),
            )
            if site_audit:
                raw_site_findings = site_audit.pop("findings", [])
                result["semrush_site_audit"] = site_audit
                result["_semrush_findings"] = _semrush_findings(raw_site_findings)
            else:
                result["enrichment_errors"].append(
                    {
                        "service": "semrush_site_audit",
                        "message": (
                            "No completed Semrush Site Audit project matched this "
                            "client domain. Organic research is still available."
                        ),
                    }
                )
            primary_seeds = seed_phrases(job.location, property_name, vertical)
            secondary_seeds = [
                phrase
                for market in secondary_locations
                for phrase in seed_phrases(market, property_name, vertical)
            ]
            audit_seeds = list(dict.fromkeys([*primary_seeds, *secondary_seeds]))
            research_seeds = [*primary_seeds[:2], *secondary_seeds[:2]]
            for phrase in research_seeds:
                related.extend(self.semrush.get_keyword_ideas(phrase, limit=15))
            seed_metrics = self.semrush.get_keyword_data(audit_seeds)
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
            property_name=property_name,
            rankings=rankings,
            related=related,
            seed_metrics=seed_metrics,
            approved_targets=list(job.approved_keyword_targets),
            property_terms=_property_terms(vertical, target_markets),
            excluded_terms=excluded_terms,
            competitor_terms=competitor_terms,
            vertical=vertical,
            secondary_locations=secondary_locations,
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

        approved_keywords = [
            candidate for candidate in keywords if candidate.get("source") == "approved"
        ]
        targeting_pool = approved_keywords or keywords
        keywords_by_page: dict[str, list[str]] = {}
        for candidate in targeting_pool:
            assigned = candidate.get("assigned_page") or job.target_url
            keywords_by_page.setdefault(assigned, [])
            if len(keywords_by_page[assigned]) < 3:
                keywords_by_page[assigned].append(candidate["keyword"])
        default_keywords = (
            []
            if approved_keywords
            else [candidate["keyword"] for candidate in keywords[:3]]
        )

        selected_pages = pages[:MAX_GENERATION_PAGES]
        body_copy, body_copy_errors = fetch_body_copy_for_pages(
            [page.url for page in selected_pages]
        )
        result["body_copy_coverage"] = {
            "attempted": len(selected_pages),
            "extracted": sum(
                1 for item in body_copy.values() if item.get("body_text")
            ),
            "failed": len(body_copy_errors),
        }
        if body_copy_errors:
            result["enrichment_errors"].append(
                {
                    "service": "content_fetch",
                    "message": (
                        f"Visible body copy could not be extracted from "
                        f"{len(body_copy_errors)} of {len(selected_pages)} pages."
                    ),
                }
            )

        generation_pages = [
            {
                "url": page.url,
                "title": page.title,
                "meta_description": page.meta_description,
                "h1": page.h1,
                "keywords": keywords_by_page.get(page.url) or default_keywords,
                "body_text": body_copy.get(page.url, {}).get("body_text", ""),
                "body_word_count": body_copy.get(page.url, {}).get(
                    "body_word_count", 0
                ),
            }
            for page in selected_pages
        ]
        if generation_pages:
            try:
                generated_recommendations = [
                    {**item, "requires_human_review": True}
                    for item in self.generator.generate_bulk_metadata(
                        generation_pages,
                        mode="existing",
                        client_context={
                            "name": property_name,
                            "location": " / ".join(
                                [job.location, *secondary_locations]
                            ),
                            "vertical": vertical,
                            "differentiators": intake.get("differentiators", ""),
                            "amenities": intake.get("amenities", ""),
                            "avoided_terms": intake.get("avoided_terms", ""),
                            "title_style_guide": intake.get("title_style_guide", ""),
                            "fair_housing_enabled": bool(
                                intake.get("fair_housing_enabled", False)
                            ),
                            "report_variant": job.options.get(
                                "report_variant", "full_client"
                            ),
                        },
                    )
                ]
                result["content_recommendations"] = _limit_content_recommendations(
                    generated_recommendations,
                    job.options.get("report_variant", "full_client"),
                )
            except Exception as exc:  # noqa: BLE001
                result["enrichment_errors"].append(_safe_error("anthropic", exc))

        images = [
            image.to_dict()
            for image in inventory.images_missing_alt[:MAX_ALT_TEXT_IMAGES]
        ]
        if images:
            try:
                result["alt_text_recommendations"] = self.generator.generate_alt_text(
                    images,
                    fair_housing_enabled=bool(
                        intake.get("fair_housing_enabled", False)
                    ),
                )
            except Exception as exc:  # noqa: BLE001
                result["enrichment_errors"].append(_safe_error("anthropic", exc))

        if job.run_performance or job.run_accessibility:
            targets = [page.url for page in pages[:MAX_PAGESPEED_PAGES]] or [
                job.target_url
            ]
            pagespeed_errors: list[Exception] = []
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
                    pagespeed_errors.append(exc)
            if pagespeed_errors:
                error = _safe_error("pagespeed", pagespeed_errors[0])
                error["message"] = (
                    f"{error['message']} "
                    f"({len(pagespeed_errors)} of {len(targets)} sampled pages failed)"
                )
                result["enrichment_errors"].append(error)

        return result


def _safe_error(service: str, exc: Exception) -> dict[str, str]:
    message = str(exc) or exc.__class__.__name__
    message = re.sub(r"([?&]key=)[^&\s]+", r"\1[REDACTED]", message)
    return {
        "service": service,
        "message": message[:500],
    }


def _merge_competitors(
    semrush: SemrushClient,
    discovered: list[dict],
    provided_domains: list[str],
) -> list[dict]:
    discovered_by_domain = {
        _normalize_domain(item.get("domain", "")): item
        for item in discovered
        if item.get("domain")
    }
    results: list[dict] = []
    provided = []
    for raw_domain in provided_domains[:10]:
        domain = _normalize_domain(str(raw_domain))
        if not domain or domain in provided:
            continue
        provided.append(domain)
        discovered_item = discovered_by_domain.get(domain, {})
        overview = semrush.get_domain_overview(domain)
        results.append(
            {
                "domain": domain,
                "source": "provided",
                "competition_level": discovered_item.get("competition_level", 0),
                "common_keywords": discovered_item.get("common_keywords", 0),
                "organic_keywords": overview.get("organic_keywords", 0),
                "organic_traffic": overview.get("organic_traffic", 0),
            }
        )

    results.extend(
        {
            **item,
            "source": "semrush",
        }
        for item in discovered
        if _normalize_domain(item.get("domain", "")) not in provided
    )
    return results


def _normalize_domain(value: str) -> str:
    return value.strip().lower().removeprefix("www.")


def _list_values(value) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [
        item.strip()
        for item in re.split(r"[\n,;]+", str(value or ""))
        if item.strip()
    ]


def _competitor_terms(values: list[str]) -> list[str]:
    terms: set[str] = set()
    for value in values:
        lowered = value.strip().lower()
        if not lowered:
            continue
        terms.add(lowered)
        domain = _normalize_domain(urlsplit(
            lowered if "://" in lowered else f"https://{lowered}"
        ).hostname or "")
        if domain:
            brand = domain.split(".", 1)[0].replace("-", " ")
            if len(brand) > 2:
                terms.add(brand)
    return sorted(terms)


def _property_terms(vertical: str, target_markets: list[str]) -> list[str]:
    by_vertical = {
        "multifamily": [
            "apartment", "apartments", "rent", "rental", "rentals",
            "studio", "bedroom", "bedrooms", "townhome", "townhomes",
        ],
        "new_homes": [
            "home", "homes", "house", "houses", "townhome", "townhomes",
            "condo", "condominiums", "construction", "builder",
        ],
        "senior_housing": [
            "senior", "55 plus", "55+", "active adult", "apartment",
            "apartments", "community", "communities",
        ],
        "senior_living": [
            "senior", "55 plus", "55+", "active adult", "apartment",
            "apartments", "community", "communities",
        ],
        "master_planned": [
            "master planned", "community", "communities", "home", "homes",
            "house", "houses", "townhome", "townhomes", "new construction",
        ],
        "luxury_living": [
            "luxury", "home", "homes", "residence", "residences",
            "apartment", "apartments", "condo", "condominiums",
        ],
        "corporate": [],
        "other": [],
    }
    return [*by_vertical.get(vertical, []), *target_markets]


def _limit_content_recommendations(
    recommendations: list[dict],
    report_variant: str,
) -> list[dict]:
    if report_variant == "in_house":
        return [
            {**item, "proposed_content": "", "current_body_text": ""}
            for item in recommendations
        ]

    content_candidates = sorted(
        (
            item
            for item in recommendations
            if item.get("proposed_content")
        ),
        key=lambda item: (
            int(item.get("current_body_word_count") or 0),
            item.get("url", ""),
        ),
    )
    selected_urls = {item.get("url") for item in content_candidates[:7]}
    return [
        item
        if item.get("url") in selected_urls
        else {**item, "proposed_content": "", "current_body_text": ""}
        for item in recommendations
    ]


_SEMRUSH_RULE_MAP = {
    2: ("response_codes", "client_error_4xx"),
    3: ("metadata", "missing_title"),
    103: ("headings", "missing_h1"),
    104: ("headings", "multiple_h1"),
    106: ("metadata", "missing_meta_description"),
    109: ("response_codes", "redirection_3xx"),
    110: ("images", "missing_alt_attribute"),
    214: ("response_codes", "redirection_3xx"),
}


def _semrush_findings(rows: list[dict]) -> list[Finding]:
    findings = []
    for row in rows:
        issue_id = int(row.get("issue_id") or 0)
        title = str(row.get("title") or f"Semrush issue {issue_id}")
        category, issue_type = _SEMRUSH_RULE_MAP.get(
            issue_id,
            (_semrush_category(title), f"semrush_site_audit_{issue_id}"),
        )
        page_url = str(row.get("page_url") or "")
        resource_url = str(row.get("resource_url") or "")
        evidence = json.dumps(
            {
                "issue": issue_type,
                "semrush_issue_id": issue_id,
                "details": row.get("details") or {},
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        identity = "\x1f".join(
            (category, issue_type, page_url, resource_url, evidence)
        )
        severity = {
            "error": Severity.HIGH,
            "warning": Severity.MEDIUM,
            "notice": Severity.INFO,
        }.get(row.get("level"), Severity.INFO)
        findings.append(
            Finding(
                id=hashlib.sha256(identity.encode("utf-8")).hexdigest(),
                category=category,
                severity=severity,
                issue_type=issue_type,
                page_url=page_url,
                resource_url=resource_url,
                evidence=evidence,
                recommendation=f"Review and resolve the Semrush Site Audit issue: {title}.",
                source_file="semrush_site_audit",
                metadata={
                    "source": "semrush",
                    "semrush_issue_id": issue_id,
                    "semrush_title": title,
                    "semrush_description": row.get("description", ""),
                    "semrush_row": row.get("details") or {},
                },
            )
        )
    return findings


def _semrush_category(title: str) -> str:
    lowered = title.lower()
    if any(term in lowered for term in ("title", "meta description")):
        return "metadata"
    if any(term in lowered for term in ("h1", "content", "word count")):
        return "content"
    if any(term in lowered for term in ("link", "redirect", "4xx", "5xx")):
        return "links"
    if any(term in lowered for term in ("image", "alt")):
        return "images"
    if any(term in lowered for term in ("https", "hsts", "certificate", "security")):
        return "security"
    if "canonical" in lowered:
        return "canonicalization"
    return "crawlability"
