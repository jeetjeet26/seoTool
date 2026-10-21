"""Regenerate specified audit reports from stored findings and retained evidence.

Defaults to prepare-only. --publish verifies uploads then atomically replaces
report references and enriched findings, with concurrency guards and backups.
Existing finding IDs, status, publication state and staff edits are preserved.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import Counter
from contextlib import closing
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid5

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
import psycopg
from psycopg.rows import dict_row
from openpyxl import load_workbook

from modules.models import Finding, Severity
from modules.pagespeed import parse_lighthouse_result
from modules.technical_findings import VERSION, enrich_technical_findings, lighthouse_findings
from worker.artifacts import _StorageClient
from worker.exports import generate_report_exports


def serial(value):
    return json.loads(json.dumps(value, default=str))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit-ids", required=True, help="JSON file containing an explicit array of audit IDs")
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    connection_options = {"row_factory": dict_row, "connect_timeout": 20}
    for key, env in (("host", "TECHNICAL_DB_HOST"), ("user", "TECHNICAL_DB_USER"), ("port", "TECHNICAL_DB_PORT")):
        if os.getenv(env):
            connection_options[key] = os.environ[env]
    def connect():
        return psycopg.connect(os.environ["SUPABASE_DB_URL"], **connection_options)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    storage = _StorageClient(os.getenv("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    revision = VERSION + "-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    records = []
    for aid in json.loads(Path(args.audit_ids).read_text()):
        UUID(aid)
        with connect() as conn:
            audit = conn.execute("select * from public.audits where id=%s", (aid,)).fetchone()
            assert audit and audit["status"] in {"completed", "review", "published"}, aid
            old_rows = conn.execute("select * from public.findings where audit_id=%s order by id", (aid,)).fetchall()
            old_artifacts = conn.execute("select * from public.artifacts where audit_id=%s order by id", (aid,)).fetchall()
        destination = output / aid
        destination.mkdir(exist_ok=True)
        (destination / f"before-{revision}.json").write_text(json.dumps(serial({"audit": audit, "findings": old_rows, "artifacts": old_artifacts}), indent=2))
        summary = json.loads(json.dumps(audit["summary"]))
        source = Path(args.source_root) / aid
        assert (source / "crawl" / "internal_all.csv").exists(), f"Missing source crawl: {aid}"
        # Enrich retained measurements without changing measurement dates or scores.
        by_url = {p.get("url"): p for p in summary.get("page_experience", [])}
        for path in sorted((source / "lighthouse").glob("page-*.json")):
            raw = json.loads(path.read_text())
            if raw.get("runtimeError") or raw.get("requestedUrl") not in by_url:
                continue
            normalized = parse_lighthouse_result(raw["requestedUrl"], raw, source="local_lighthouse")
            existing = by_url[raw["requestedUrl"]]
            assert existing.get("fetch_time") == normalized.get("fetch_time"), "Measurement changed"
            existing["performance_issues"] = normalized["performance_issues"]
        findings = [Finding(str(r["id"]), r["category"], Severity(r["severity"]), r["rule_key"], r["page_url"] or "",
                            r["resource_url"] or "", json.dumps(r["evidence"]), r["recommendation"], r["source_file"] or "",
                            {**r["metadata"], "report_title": r["title"], "report_description": r["description"]})
                    for r in old_rows if not r["metadata"].get("report_hidden")]
        stable_keys = {r["stable_key"] for r in old_rows}
        additions = []
        new_keys = {}
        for finding in lighthouse_findings(summary.get("page_experience", [])):
            if finding.id in stable_keys:
                continue
            identity = str(uuid5(UUID(aid), finding.id))
            new_keys[identity] = finding.id
            additions.append(replace(finding, id=identity))
        findings = enrich_technical_findings([*findings, *additions], summary, source / "crawl")
        summary["technical_analysis"] = {"version": VERSION, "refreshed_at": datetime.now(timezone.utc).isoformat(),
                                         "source_crawl_timestamp": summary.get("crawl_coverage", {}).get("crawl_timestamp"),
                                         "new_crawl": False, "retained_findings": len(old_rows), "added_lab_diagnostics": len(additions)}
        summary["finding_count"] = len(old_rows) + len(additions)
        all_severities = [r["severity"] for r in old_rows] + [f.severity.value for f in additions]
        summary["severity_counts"] = dict(Counter(all_severities))
        summary["category_counts"] = dict(Counter([r["category"] for r in old_rows] + [f.category for f in additions]))
        # Keep user-written executive summaries and all nontechnical recommendations intact.
        paths = generate_report_exports(aid, findings, summary, destination)
        with closing(load_workbook(paths[1], read_only=True, data_only=False)) as workbook:
            assert {"Technical SEO", "Technical Evidence", "Technical Coverage"}.issubset(workbook.sheetnames)
            evidence_rows = list(workbook["Technical Evidence"].values)[5:]
            assert {r[0] for r in evidence_rows} == {f.id for f in findings}
            assert sum(r[3] for r in list(workbook["Technical SEO"].values)[5:]) == len(findings)
            for sheet in workbook:
                assert all(cell.data_type != "f" for row in sheet for cell in row), "Unexpected formula"
        (destination / "summary.json").write_text(json.dumps(summary, indent=2))
        (destination / "findings.json").write_text(json.dumps([f.__dict__ for f in findings], indent=2))
        if args.publish:
            uploaded = []
            for path in paths:
                content = path.read_bytes()
                digest = hashlib.sha256(content).digest()
                object_path = f"{aid}/report-export/{revision}/{path.name}"
                mime = "text/csv" if path.suffix == ".csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                storage.put_object("audit-artifacts", object_path, content, mime)
                assert hashlib.sha256(storage.get_object("audit-artifacts", object_path)).digest() == digest
                uploaded.append((object_path, mime, len(content), digest))
            with connect() as conn:
                live = conn.execute("select * from public.audits where id=%s for update", (aid,)).fetchone()
                live_rows = conn.execute("select * from public.findings where audit_id=%s order by id for update", (aid,)).fetchall()
                live_artifacts = conn.execute("select * from public.artifacts where audit_id=%s order by id for update", (aid,)).fetchall()
                assert serial(live) == serial(audit) and serial(live_rows) == serial(old_rows) and serial(live_artifacts) == serial(old_artifacts), "Concurrent edit; report left unchanged"
                version = conn.execute("select coalesce(max(version),0) as n from public.audit_snapshots where audit_id=%s", (aid,)).fetchone()["n"]
                conn.execute("insert into public.audit_snapshots(audit_id,version,snapshot) values(%s,%s,%s::jsonb)", (aid, version + 1, json.dumps(audit["summary"])))
                for f in findings:
                    if f.id in new_keys:
                        conn.execute("""insert into public.findings(id,audit_id,stable_key,category,rule_key,title,description,severity,page_url,resource_url,recommendation,evidence,source_file,metadata)
                            values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s::jsonb)""",
                            (f.id, aid, new_keys[f.id], f.category, f.issue_type, f.metadata.get("report_title", f.issue_type), f.metadata["report_description"], f.severity.value,
                             f.page_url, f.resource_url or None, f.recommendation, f.evidence, f.source_file, json.dumps(f.metadata)))
                    else:
                        conn.execute("""update public.findings set description=%s,recommendation=%s,evidence=%s::jsonb,resource_url=%s,metadata=%s::jsonb
                                        where id=%s and audit_id=%s""", (f.metadata["report_description"], f.recommendation, f.evidence, f.resource_url or None, json.dumps(f.metadata), f.id, aid))
                conn.execute("delete from public.artifacts where audit_id=%s and kind='report-export'", (aid,))
                for obj, mime, size, digest in uploaded:
                    conn.execute("insert into public.artifacts(audit_id,kind,bucket_id,object_path,content_type,byte_size,sha256) values(%s,'report-export','audit-artifacts',%s,%s,%s,%s)", (aid,obj,mime,size,digest))
                conn.execute("update public.audits set summary=%s::jsonb where id=%s", (json.dumps(summary),aid))
                conn.execute("insert into public.audit_events(audit_id,event_type,message,payload) values(%s,'audit.technical_refreshed',%s,%s::jsonb)",
                             (aid,"Technical findings enriched from retained crawl and lab evidence; report downloads regenerated.",json.dumps(summary["technical_analysis"])))
            with connect() as conn:
                verified = conn.execute("select summary from public.audits where id=%s",(aid,)).fetchone()["summary"]
                assert verified == summary
                assert conn.execute("select count(*) as n from public.findings where audit_id=%s",(aid,)).fetchone()["n"] == len(old_rows) + len(additions)
        record = {"audit_id": aid, "retained": len(old_rows), "added_lab": len(additions), "exported": len(findings), "published": args.publish}
        records.append(record)
        (output / "results.json").write_text(json.dumps(records, indent=2))
        print(json.dumps(record), flush=True)


if __name__ == "__main__":
    main()
