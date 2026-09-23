"""Generate client-downloadable CSV and Excel artifacts from structured results.

Thin orchestration over the named export profiles in
:mod:`worker.export_profiles`.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from modules.models import Finding
from worker.export_profiles import (
    build_client_workbook,
    internal_findings_csv,
)


def generate_report_exports(
    audit_id: str,
    findings: Iterable[Finding],
    summary: dict[str, Any],
    output_dir: Path,
) -> list[Path]:
    rows = list(findings)
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)

    csv_path = directory / f"seo-audit-{audit_id}.csv"
    csv_path.write_text(internal_findings_csv(rows), encoding="utf-8-sig")

    excel_path = directory / f"seo-audit-{audit_id}.xlsx"
    workbook = build_client_workbook(
        property_name=str(
            (summary.get("property_context") or {}).get("name")
            or summary.get("target_location")
            or summary.get("target_url")
            or "SEO Audit"
        ),
        keywords=summary.get("keyword_strategy") or [],
        metadata_items=summary.get("content_recommendations") or [],
        onpage_items=[
            item
            for item in summary.get("content_recommendations") or []
            if item.get("proposed_content")
        ],
        alt_text_items=summary.get("alt_text_recommendations") or [],
        technical_rows=technical_rows_from_findings(rows),
        page_experience=summary.get("page_experience") or [],
        recap_lines=_recap_lines(summary),
        report_variant=summary.get("report_variant", "full_client"),
        include_supplemental=True,
    )
    progress = summary.get("recommendation_progress") or {}
    if progress.get("previous_audit_id"):
        sheet = workbook.create_sheet("Previous Recommendations")
        sheet.append(["Page", "Image", "Field", "Status", "Evidence"])
        for item in progress.get("items", []):
            # Explicit string cells prevent report text becoming Excel formulas.
            sheet.append([item.get(key, "") for key in ("url", "image_url", "field", "status", "reason")])
            for cell in sheet[sheet.max_row]:
                cell.data_type = "s"
    workbook.save(excel_path)
    return [csv_path, excel_path]


def technical_rows_from_findings(findings: list[Finding]) -> list[dict]:
    """Group findings into the workbook's technical contract: one row per
    issue type with occurrence counts and an example location."""

    counts: Counter[tuple[str, str, str]] = Counter()
    examples: dict[tuple[str, str, str], Finding] = {}
    for finding in findings:
        # Keep individually edited findings distinct in the grouped handoff.
        edited_key = finding.id if finding.metadata.get("report_chat_edited") else ""
        key = (finding.category, finding.issue_type, edited_key)
        counts[key] += 1
        examples.setdefault(key, finding)

    rows = []
    for (category, issue_type, edited_key), count in sorted(
        counts.items(), key=lambda entry: (-entry[1], entry[0])
    ):
        example = examples[(category, issue_type, edited_key)]
        rows.append(
            {
                "category": category,
                "issue": example.metadata.get("report_title") or issue_type.replace("_", " ").title(),
                "description": example.metadata.get("report_description") or example.recommendation
                or f"{issue_type.replace('_', ' ').title()} detected during the crawl.",
                "occurrences": count,
                "example_url": example.page_url or example.resource_url or "",
                "recommendation": example.recommendation,
            }
        )
    return rows


def _recap_lines(summary: dict[str, Any]) -> list[str]:
    lines = []
    if summary.get("executive_summary"):
        lines.append(summary["executive_summary"])
    if summary.get("pages_scanned"):
        lines.append(f"Pages crawled: {summary['pages_scanned']}")
    if summary.get("finding_count") is not None:
        lines.append(f"Technical findings identified: {summary['finding_count']}")
    if summary.get("keyword_strategy"):
        lines.append(f"Keywords researched: {len(summary['keyword_strategy'])}")
    if summary.get("content_recommendations"):
        lines.append(
            f"Pages with metadata recommendations: {len(summary['content_recommendations'])}"
        )
    if summary.get("alt_text_recommendations"):
        lines.append(
            f"Images with proposed alt text: {len(summary['alt_text_recommendations'])}"
        )
    if summary.get("score") is not None:
        lines.append(f"Site health score: {summary['score']}/100")
    return lines
