"""Refresh report downloads after a chat edit, without recrawling the site.

The audit row is locked through generation and upload so another edit cannot
publish an older workbook over a newer revision. Files have revision-specific
names. The existing export remains available until both replacements succeed.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

from modules.models import Finding, Severity
from worker.exports import generate_report_exports

LOGGER = logging.getLogger(__name__)


def process_report_edits(repository, artifacts, work_root: Path) -> bool:
    with repository._connect() as connection:
        audit = connection.execute(
            """select id, summary from public.audits
               where summary->'report_edit'->>'export_state' = 'pending'
                 and status::text in ('completed', 'review', 'published')
               order by updated_at for update skip locked limit 1"""
        ).fetchone()
        if not audit:
            return False
        audit_id = str(audit["id"])
        summary = audit["summary"]
        edit = summary["report_edit"]
        revision = edit["revision"]
        try:
            rows = connection.execute(
                """select * from public.findings where audit_id = %s
                   and coalesce(metadata->>'report_hidden', 'false') <> 'true'
                   order by id""", (audit_id,)
            ).fetchall()
            findings = [Finding(
                id=str(row["id"]), category=row["category"],
                severity=Severity(row["severity"]), issue_type=row["rule_key"],
                page_url=row["page_url"] or "", resource_url=row["resource_url"] or "",
                evidence=json.dumps(row["evidence"]), recommendation=row["recommendation"],
                source_file=row["source_file"] or "",
                metadata={**(row["metadata"] or {}), "report_title": row["title"], "report_description": row["description"]},
            ) for row in rows]
            directory = Path(work_root) / "report-edits" / audit_id / revision
            paths = generate_report_exports(audit_id, findings, summary, directory)
            uploaded = []
            for path in paths:
                content = path.read_bytes()
                object_path = f"{audit_id}/report-export/{revision}/{path.name}"
                content_type = "text/csv" if path.suffix == ".csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                artifacts.storage.put_object(artifacts.BUCKET, object_path, content, content_type)
                uploaded.append((object_path, content_type, len(content), hashlib.sha256(content).digest()))
            # A savepoint ensures SQL failures cannot leave only half the metadata.
            with connection.transaction():
                connection.execute("delete from public.artifacts where audit_id = %s and kind = 'report-export'", (audit_id,))
                for object_path, content_type, size, digest in uploaded:
                    connection.execute(
                        """insert into public.artifacts (audit_id, kind, bucket_id, object_path, content_type, byte_size, sha256)
                           values (%s, 'report-export', 'audit-artifacts', %s, %s, %s, %s)""",
                        (audit_id, object_path, content_type, size, digest),
                    )
                edit["export_state"] = "ready"
                connection.execute("update public.audits set summary = %s::jsonb where id = %s", (json.dumps(summary), audit_id))
            for path in paths:
                path.unlink(missing_ok=True)
        except Exception:
            LOGGER.exception("Report export refresh failed for %s", audit_id)
            edit["export_attempts"] = edit.get("export_attempts", 0) + 1
            edit["export_state"] = "failed" if edit["export_attempts"] >= 3 else "pending"
            connection.execute("update public.audits set summary = %s::jsonb where id = %s", (json.dumps(summary), audit_id))
        return True
