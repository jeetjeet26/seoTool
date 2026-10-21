import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from modules.models import Finding, Severity
from modules.audit_service import AuditService
from modules.pagespeed import parse_lighthouse_result
from modules.technical_findings import enrich_technical_findings, lighthouse_findings, coverage_rows
from worker.exports import technical_evidence_rows, technical_rows_from_findings


class TechnicalFindingsTests(unittest.TestCase):
    def finding(self, **kwargs):
        data = dict(id="a" * 64, category="response_codes", severity=Severity.MEDIUM,
                    issue_type="redirection_3xx", page_url="https://example.com/old", resource_url="",
                    evidence='{"status_code":"302"}', recommendation="Link directly.", source_file="crawl.csv",
                    metadata={"crawler_row": {"redirect_url": "/new"}})
        return Finding(**{**data, **kwargs})

    def test_redirect_alias_recovers_target_without_claiming_final_destination(self):
        self.assertEqual(AuditService._urls_for_row({"address": "a", "redirect_url": "b"}, "redirect"), ("a", "b"))
        original = self.finding()
        enriched = enrich_technical_findings([original])[0]
        self.assertEqual(enriched.id, original.id)
        self.assertEqual(enriched.resource_url, "https://example.com/new")
        self.assertIn("recorded next hop", enriched.recommendation)
        self.assertIn("301/308", enriched.recommendation)
        self.assertEqual(enrich_technical_findings([enriched])[0], enriched)

    def test_missing_destination_and_edited_copy_are_preserved(self):
        finding = self.finding(metadata={"report_chat_edited": True, "report_description": "Staff description"})
        result = enrich_technical_findings([finding])[0]
        self.assertEqual(result.recommendation, finding.recommendation)
        self.assertEqual(result.metadata["report_description"], "Staff description")
        self.assertIn("not captured", result.metadata["technical"]["observation"])

    def test_inventory_enrichment_keeps_raw_title_and_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "internal_all.csv").write_text('Address,Title 1,Indexability\nhttps://example.com/old,Actual title,Indexable\n')
            result = enrich_technical_findings([self.finding(issue_type="long_title")], crawl_dir=directory)[0]
        self.assertEqual(json.loads(result.evidence)["title_1"], "Actual title")
        self.assertIn("not a Google character-limit", result.metadata["technical"]["impact"])

    def test_grouped_export_keeps_all_urls_and_lossless_evidence(self):
        evidence = json.dumps({"details": "a" * 9000})
        rows = enrich_technical_findings([self.finding(evidence=evidence), self.finding(id="b" * 64, page_url="https://example.com/other")])
        grouped = technical_rows_from_findings(rows)
        self.assertEqual(grouped[0]["occurrences"], 2)
        self.assertNotIn("recorded next hop", grouped[0]["recommendation"])
        detail = technical_evidence_rows(rows)
        self.assertEqual({r[2] for r in detail}, {r.page_url for r in rows})
        self.assertEqual("".join(r[4] for r in detail if r[0] == rows[0].id and r[3].startswith("Observed evidence")), rows[0].evidence)

    def test_failed_lighthouse_diagnostic_preserves_resource_and_lab_scope(self):
        payload = {"categories": {"performance": {"auditRefs": [{"id": "unused-javascript"}, {"id": "other"}]}},
                   "audits": {"unused-javascript": {"score": 0, "displayValue": "100 KiB", "description": "Remove unused JS.",
                              "details": {"items": [{"url": "https://example.com/app.js", "wastedBytes": 100000}]}},
                              "other": {"score": 1, "details": {"items": [{"url": "ignored"}]}}}}
        page = parse_lighthouse_result("https://example.com/", payload)
        self.assertEqual(len(page["performance_issues"]), 1)
        findings = lighthouse_findings([page])
        with tempfile.TemporaryDirectory() as directory:
            enriched = enrich_technical_findings(findings, crawl_dir=directory)[0]
        self.assertIn("DevTools Coverage", enriched.recommendation)
        self.assertIn("app.js", enriched.evidence)
        self.assertIn("lab diagnostic", enriched.metadata["technical"]["observation"])
        self.assertIn("Not established", str(coverage_rows({})))
