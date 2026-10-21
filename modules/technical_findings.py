"""Evidence-backed technical remediation, shared by audit runs and report refreshes.

Enrichment never changes a finding's identity or overwrites a staff edit. Missing
evidence remains explicit; a crawler flag is not proof of traffic loss or cause.
"""
from __future__ import annotations

import csv
import hashlib
import json
from collections import defaultdict
from dataclasses import replace
from pathlib import Path
from urllib.parse import urljoin

from modules.models import Finding, Severity

VERSION = "technical-v2"

PERFORMANCE_ACTIONS = {
    "unused-javascript": "Use DevTools Coverage on the listed scripts during navigation and form interactions. Remove unused modules, split bundles by page, and defer nonessential third-party scripts. Retest lead forms and analytics before release.",
    "unused-css-rules": "Use Coverage on the listed stylesheets across responsive breakpoints and interactive states. Remove unused rules or load page-specific styles separately; preserve rules needed after interaction.",
    "image-delivery-insight": "Inspect the listed image URLs and displayed dimensions. Generate appropriately sized responsive variants, set srcset/sizes, and compare modern-format compression visually. Do not lazy-load the LCP image.",
    "render-blocking-insight": "Inspect the listed render-blocking stylesheets and scripts in the waterfall. Inline only essential critical styles, defer noncritical scripts, and load noncritical styles without blocking first render. Check for unstyled flashes and broken dependencies.",
    "cache-insight": "Inspect Cache-Control and versioning on the listed static resources. Apply longer cache lifetimes to versioned assets you control and invalidate through content-hashed URLs. Do not apply immutable caching to personalized HTML; discuss third-party resources with their owner.",
    "font-display-insight": "Inspect the listed font faces. Set an appropriate font-display strategy and a metrically compatible fallback; preload only fonts used above the fold. Recheck text visibility and layout shifts.",
    "forced-reflow-insight": "Profile the listed script locations in DevTools Performance. Batch DOM reads before writes and avoid repeated synchronous layout in animation or scroll handlers. Compare traces after changing the implicated code.",
    "lcp-discovery-insight": "Inspect the reported LCP element and its request. Make the critical resource discoverable in initial HTML, avoid lazy loading it, and use fetchpriority or preload only when the trace supports it. Recheck competing downloads.",
    "layout-shifts": "Inspect the reported shifted elements and preceding network/DOM activity. Reserve image and embed dimensions, avoid inserting content above existing content, and stabilize font fallback metrics. Replay the same viewport to verify the culprit.",
    "legacy-javascript-insight": "Inspect the listed scripts for unnecessary transforms and polyfills. Adjust browser targets for supported clients and ship modern bundles where appropriate. Test required browsers and third-party dependencies before removing compatibility code.",
}

# impact, implementation, acceptance criteria, accountable role
PLAYBOOKS = {
    "missing_h1": (
        "The crawl found no H1. Check the rendered page before treating this as a missing visible heading; the source HTML alone does not establish a rendering failure.",
        "Inspect the page's main visible heading and its shared template. Use a descriptive H1 for the main page topic, preserve the visual design, and avoid using the logo as the primary heading. Use the H1 Tags worksheet's page-specific proposal where available.",
        "Re-crawl the affected URLs and inspect the rendered heading outline. Confirm a descriptive primary heading is exposed to users and assistive technology, with no duplicate heading introduced by the template.", "Web developer"),
    "redirection_3xx": (
        "A redirect adds a request when followed. It may be intentional; this response alone does not prove a broken link or ranking loss.",
        "Confirm the intended destination and whether the move is permanent. Keep a temporary redirect for a genuinely temporary move; use 301/308 for a permanent move. Find navigation, content and sitemap references to the old URL and update applicable references after verifying the target.",
        "Follow the complete chain and confirm the intended final page returns 200 without a loop. Re-crawl linking pages to confirm applicable links point directly to the verified destination.", "Web developer / SEO"),
    "long_title": (
        "The title exceeds the crawler's character threshold. This is an editorial review flag, not a Google character-limit violation or evidence of lost rankings.",
        "Review the current title alongside page intent. Keep distinguishing topic and community information early, remove redundant boilerplate, and use the Title Tags proposal where appropriate. Preview truncation at realistic device widths before shortening useful wording.",
        "Confirm one accurate title in the HTML, uniqueness among indexable pages, and a readable preview. Character count alone is not the acceptance criterion.", "SEO / content editor"),
    "long_meta_description": (
        "The description exceeds the crawler's configured length. Search snippets vary by query and device; this is a snippet-copy opportunity, not an indexing failure.",
        "Review the actual description for repeated boilerplate. Put page-specific value first and use the Description Tags proposal where appropriate, retaining factual details and a relevant action. Preview the snippet rather than enforcing a universal character limit.",
        "Confirm one relevant description in source HTML and review its preview. Check distinct page intent and avoid duplicating another community's wording.", "SEO / content editor"),
    "missing_meta_description": (
        "No description was recorded. Search engines can generate a snippet from page content, but the site is missing an editorial snippet suggestion.",
        "Populate the page's SEO description field using the page-specific Description Tags proposal where available. Verify the template outputs one description tag in the head.",
        "Re-crawl and confirm a non-empty, page-specific description in the HTML head without duplicate tags.", "SEO / content editor"),
    "duplicate_meta_description": (
        "Multiple crawled URLs share description text. Confirm these are distinct indexable pages before rewriting intentional variants.",
        "Compare the affected URLs and their intended canonical pages. For distinct pages, replace shared boilerplate with page-specific descriptions. For true duplicates, review consolidation and canonical signals instead of merely changing the text.",
        "Re-crawl the duplicate group. Distinct indexable pages should have distinct relevant descriptions; intentional variants should have consistent canonical signals.", "SEO / content editor"),
    "duplicate_title": (
        "Multiple crawled URLs share title text, which can obscure distinctions between pages. Confirm indexability and intent before changing intentional variants.",
        "Compare the duplicate group, canonical tags and page intent. Give distinct indexable pages distinguishing titles; review canonical consolidation for genuine duplicate URLs. Inspect shared title-generation templates for reused defaults.",
        "Re-crawl the group and confirm distinct titles on distinct indexable pages, with consistent canonical signals for intentional variants.", "SEO / web developer"),
    "missing_title": (
        "The crawl found no title element value, leaving the page without its preferred search title.",
        "Set a descriptive title in the page SEO field and verify the template emits it in the head. Use the Title Tags proposal where available.",
        "Confirm a single non-empty, relevant title in the returned HTML and re-crawl the affected page.", "SEO / web developer"),
    "missing_canonical": (
        "The crawler did not record a canonical. Determine whether duplicate variants exist before assuming this causes an indexing problem.",
        "Choose the intended indexable URL after checking duplicate variants, redirects and internal links. Set one absolute canonical in the head and align sitemap and internal-link signals.",
        "Verify the canonical target returns 200, is indexable and does not canonicalize elsewhere unexpectedly. Re-crawl source and target.", "SEO / web developer"),
    "noindex": (
        "The crawl recorded a noindex directive. This is a problem only if the page is intended to appear in search.",
        "Confirm search intent with the page owner. If indexing is intended, remove noindex from meta robots and X-Robots-Tag as applicable; otherwise document the intentional exclusion.",
        "Re-fetch the HTML and headers and confirm directives match the approved intent. Index eligibility does not guarantee indexing.", "SEO / web developer"),
}


def _object(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def enrich_technical_findings(findings, summary=None, crawl_dir=None):
    """Return enriched copies, preserving stable IDs, staff copy and source data."""
    summary = summary or {}
    proposals = {item.get("url"): item for item in summary.get("content_recommendations", [])}
    inventory = {}
    if crawl_dir and (Path(crawl_dir) / "internal_all.csv").exists():
        from modules.audit_service import AuditService
        with (Path(crawl_dir) / "internal_all.csv").open(encoding="utf-8-sig", newline="") as stream:
            for raw in csv.DictReader(stream):
                row = {AuditService._column_key(k): v for k, v in raw.items() if k}
                inventory[row.get("address", "")] = row
    groups = defaultdict(list)
    for finding in findings:
        groups[finding.issue_type].append(finding.page_url)
    results = []
    for finding in findings:
        evidence = _object(finding.evidence)
        row = {**inventory.get(finding.page_url, {}), **finding.metadata.get("crawler_row", {})}
        resource = finding.resource_url
        if finding.issue_type == "redirection_3xx":
            destination = row.get("redirect_url") or row.get("redirect_uri") or evidence.get("redirect_url") or resource
            if destination:
                resource = urljoin(finding.page_url, destination)
                evidence["redirect_url"] = resource
        fields = ("status_code", "indexability", "indexability_status", "title_1", "title_1_length",
                  "meta_description_1", "meta_description_1_length", "h1_1", "canonical_link_element_1", "inlinks")
        evidence.update({k: row[k] for k in fields if k in row and row[k] is not None})
        impact, steps, acceptance, owner = PLAYBOOKS.get(finding.issue_type, (
            "The recorded check needs review in the context of this page's intended behavior.",
            finding.recommendation + " Inspect the recorded resource and source evidence before changing the page or shared template.",
            "Repeat the original check on the affected URL and resource after deployment; confirm the observed condition is resolved without changing intended page behavior.",
            "Web developer / SEO"))
        observed = "; ".join(f"{k.replace('_', ' ')}: {v}" for k, v in evidence.items()
                             if k != "issue" and isinstance(v, (str, int, float)) and str(v))
        if finding.issue_type == "missing_h1":
            observed = "H1 absent in crawl export. " + observed
        elif finding.issue_type == "redirection_3xx":
            observed += f"; recorded redirect target: {resource}" if resource else "; redirect destination not captured"
            steps += (f" The recorded next hop is {resource}; verify its final response before using it as the final destination."
                      if resource else " Capture the Location response header and follow the redirect; no destination was captured in this evidence.")
        related = sorted(set(groups[finding.issue_type]))
        pattern = (f"The same check affects {len(related)} URLs in this audit. Compare their shared components and fix a template once if a common cause is verified. Shared cause is not yet confirmed."
                   if len(related) > 1 else "One affected URL recorded for this check.")
        proposal_field = {"missing_h1": "proposed_h1", "missing_title": "proposed_title", "long_title": "proposed_title",
                          "duplicate_title": "proposed_title", "missing_meta_description": "proposed_meta_description",
                          "long_meta_description": "proposed_meta_description", "duplicate_meta_description": "proposed_meta_description"}.get(finding.issue_type)
        proposed = proposals.get(finding.page_url, {}).get(proposal_field) if proposal_field else None
        if proposed:
            steps += f" Existing report draft for this page (review before implementation): {proposed}"
        technical = {"version": VERSION, "observation": observed or "See the source export for the recorded check.",
                     "impact": impact, "implementation": steps, "validation": acceptance, "owner": owner,
                     "pattern": pattern, "affected_url_count": len(related),
                     "evidence_limit": "Evidence describes the recorded crawl or lab measurement; current behavior and root cause require validation."}
        if finding.metadata.get("technical", {}).get("version") == VERSION and (not crawl_dir or finding.source_file == "lighthouse"):
            technical = finding.metadata["technical"]
        edited = finding.metadata.get("report_chat_edited")
        description = f"Observed: {technical['observation']}\nWhy it matters: {technical['impact']}\nScope: {technical['pattern']}"
        recommendation = f"Owner: {technical['owner']}\nImplementation: {technical['implementation']}\nValidation: {technical['validation']}"
        metadata = {**finding.metadata, "technical": technical}
        if not edited:
            metadata["report_description"] = description
        results.append(replace(finding, resource_url=resource, evidence=json.dumps(evidence, sort_keys=True),
                               recommendation=finding.recommendation if edited else recommendation, metadata=metadata))
    return results


def lighthouse_findings(page_experience):
    """Create evidence-bearing lab findings, never claim field CWV or sitewide coverage."""
    results = []
    for page in page_experience:
        for issue in page.get("performance_issues", []):
            if issue.get("id") not in PERFORMANCE_ACTIONS:
                continue
            if not issue.get("details", {}).get("items"):
                continue
            rule = "lighthouse_" + issue["id"].replace("-", "_")
            url = page.get("final_url") or page.get("url", "")
            evidence = {"issue": rule, "measurement": "lab", "fetch_time": page.get("fetch_time"),
                        "display_value": issue.get("display_value"), "details": issue["details"]}
            identity = hashlib.sha256(f"{rule}\x1f{url}".encode()).hexdigest()
            impact = f"Lighthouse reported {issue.get('title', issue['id'])} on this sampled page. {issue.get('display_value') or ''} This is a lab diagnostic, not field Core Web Vitals or a sitewide result."
            technical = {"version": VERSION, "observation": impact, "impact": issue.get("description", ""),
                         "implementation": PERFORMANCE_ACTIONS[issue["id"]] + " Exact resource URLs and nodes are listed in Technical Evidence.",
                         "validation": "Repeat mobile Lighthouse under comparable settings and compare this diagnostic and affected resources. Check visual and functional regressions; estimated savings are not guaranteed or additive.",
                         "owner": "Web developer / performance engineer", "pattern": "Sampled page only; see Technical Evidence for resources.",
                         "affected_url_count": 1, "evidence_limit": "Lab measurement; not field data."}
            results.append(Finding(identity, "performance", Severity.MEDIUM, rule, url, "", json.dumps(evidence),
                                   technical["implementation"], "lighthouse", {"report_title": issue.get("title", rule), "technical": technical}))
    return results


def coverage_rows(summary):
    crawl = summary.get("crawl_coverage") or {}
    rows = [
        ["Crawl scope", str(crawl.get("scope") or "Scope not recorded"), f"{crawl.get('pages', 'Unknown')} HTML pages recorded", str(crawl.get("crawl_timestamp") or "Timestamp not recorded")],
        ["Root causes", "Require validation", "Repeated flags suggest shared components; they do not establish a shared cause.", "Compare rendered pages and templates before bulk changes."],
        ["Discovery and index coverage", "Not established by these findings", "An issue list does not prove coverage of orphan URLs, all link sources, rendered content or search-engine indexing.", "Reconcile a link-discovery crawl, sitemap inventory and Search Console evidence."],
        ["Performance", "Sampled lab evidence" if summary.get("page_experience") else "No measurements available", f"{len(summary.get('page_experience') or [])} sampled pages", "Use field data separately; lab results are not a sitewide Core Web Vitals verdict."],
    ]
    attempts = crawl.get("crawler_attempts") or {}
    if attempts:
        rows.append(["Crawler profile", attempts.get("selected_profile", "default"),
                     json.dumps(attempts.get("attempts", []), sort_keys=True),
                     "A browser profile changes the HTTP identity; it does not imply JavaScript rendering or bypass a network-level block."])
    for error in summary.get("enrichment_errors") or []:
        rows.append([error.get("service", "Source"), "Unavailable / limited", error.get("message", ""), "Complete this source before asserting full coverage."])
    return rows
