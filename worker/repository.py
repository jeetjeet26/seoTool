"""Direct Postgres repository used by the trusted audit worker."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row

from modules.models import Finding, ProgressEvent


@dataclass(frozen=True)
class AuditJob:
    id: str
    target_url: str
    target_city: str
    target_region: str | None
    page_limit: int
    run_performance: bool
    run_accessibility: bool
    options: dict[str, Any]
    client_id: str = ""
    client_name: str = "Client"
    client_intake: dict[str, Any] = field(default_factory=dict)
    approved_keyword_targets: tuple[dict[str, Any], ...] = ()

    @property
    def location(self) -> str:
        return ", ".join(
            value for value in (self.target_city, self.target_region) if value
        )


class WorkerRepository:
    def __init__(self, database_url: str, worker_id: str):
        self.database_url = database_url
        self.worker_id = worker_id

    def _connect(self):
        return psycopg.connect(self.database_url, row_factory=dict_row)

    def claim_next_job(self) -> AuditJob | None:
        with self._connect() as connection:
            row = connection.execute(
                "select * from private.claim_audit_job(%s)",
                (self.worker_id,),
            ).fetchone()
            if not row:
                return None
            client = connection.execute(
                "select name, intake from public.clients where id = %s",
                (row["client_id"],),
            ).fetchone()
            targets = connection.execute(
                """
                select keyword, canonical_url, role, metrics
                from public.keyword_targets
                where client_id = %s and status = 'approved'
                order by canonical_url, role, keyword
                """,
                (row["client_id"],),
            ).fetchall()
        return AuditJob(
            id=str(row["id"]),
            client_id=str(row["client_id"]),
            client_name=(client or {}).get("name") or "Client",
            target_url=row["target_url"],
            target_city=row["target_city"],
            target_region=row.get("target_region"),
            page_limit=row["page_limit"],
            run_performance=row["run_performance"],
            run_accessibility=row["run_accessibility"],
            options=row.get("options") or {},
            client_intake=(client or {}).get("intake") or {},
            approved_keyword_targets=tuple(targets),
        )

    def heartbeat(self, audit_id: str) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                "select private.heartbeat_audit_job(%s, %s) as accepted",
                (audit_id, self.worker_id),
            ).fetchone()
        return bool(row and row["accepted"])

    def record_progress(self, event: ProgressEvent) -> None:
        payload = {
            "stage": event.stage.value,
            "status": event.status.value,
            "progress": event.progress,
            "metadata": event.metadata,
            "timestamp": event.timestamp.isoformat(),
        }
        with self._connect() as connection:
            connection.execute(
                """
                update public.audits
                set current_stage = %s, progress = %s
                where id = %s and claimed_by = %s
                """,
                (
                    event.stage.value,
                    max(0, min(100, event.progress)),
                    event.audit_id,
                    self.worker_id,
                ),
            )
            connection.execute(
                """
                insert into public.audit_events (audit_id, event_type, message, payload)
                values (%s, %s, %s, %s::jsonb)
                """,
                (
                    event.audit_id,
                    f"audit.{event.stage.value}.{event.status.value}",
                    event.message,
                    json.dumps(payload, default=_json_default),
                ),
            )

    def upsert_findings(self, audit_id: str, findings: Iterable[Finding]) -> int:
        rows = list(findings)
        if not rows:
            return 0

        with self._connect() as connection:
            for finding in rows:
                evidence = _evidence_object(finding.evidence)
                connection.execute(
                    """
                    insert into public.findings (
                      audit_id, stable_key, category, rule_key, title, description,
                      severity, page_url, resource_url, recommendation, evidence,
                      source_file, metadata, last_seen_at
                    )
                    values (
                      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      %s::jsonb, %s, %s::jsonb, now()
                    )
                    on conflict (audit_id, stable_key) do update
                    set category = excluded.category,
                        rule_key = excluded.rule_key,
                        title = excluded.title,
                        description = excluded.description,
                        severity = excluded.severity,
                        page_url = excluded.page_url,
                        resource_url = excluded.resource_url,
                        recommendation = excluded.recommendation,
                        evidence = excluded.evidence,
                        source_file = excluded.source_file,
                        metadata = excluded.metadata,
                        last_seen_at = now(),
                        resolved_at = null,
                        updated_at = now()
                    """,
                    (
                        audit_id,
                        finding.stable_id,
                        finding.category,
                        finding.issue_type,
                        finding.metadata.get("semrush_title")
                        or _finding_title(finding.issue_type),
                        _finding_description(finding),
                        finding.severity.value,
                        finding.page_url or None,
                        finding.resource_url or None,
                        finding.recommendation,
                        json.dumps(evidence, default=_json_default),
                        finding.source_file or None,
                        json.dumps(finding.metadata, default=_json_default),
                    ),
                )
        return len(rows)

    def complete_job(self, audit_id: str, summary: dict[str, Any]) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                update public.audits
                set status = 'completed',
                    current_stage = 'complete',
                    progress = 100,
                    completed_at = now(),
                    heartbeat_at = now(),
                    summary = %s::jsonb,
                    failure_message = null,
                    options = options - 'crawl_import_paths'
                where id = %s and claimed_by = %s
                """,
                (json.dumps(summary, default=_json_default), audit_id, self.worker_id),
            )

    def fail_job(self, audit_id: str, message: str) -> None:
        safe_message = (message or "Audit failed")[:4000]
        with self._connect() as connection:
            connection.execute(
                """
                update public.audits
                set status = 'failed',
                    current_stage = 'failed',
                    completed_at = now(),
                    heartbeat_at = now(),
                    failure_message = %s
                where id = %s and claimed_by = %s
                """,
                (safe_message, audit_id, self.worker_id),
            )
            connection.execute(
                """
                insert into public.audit_events (audit_id, event_type, message, payload)
                values (%s, 'audit.failed', %s, '{}'::jsonb)
                """,
                (audit_id, safe_message),
            )

    def record_artifact(
        self,
        audit_id: str,
        kind: str,
        object_path: str,
        content_type: str,
        byte_size: int,
        sha256_digest: bytes,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                insert into public.artifacts (
                  audit_id, kind, object_path, content_type, byte_size, sha256
                )
                values (%s, %s, %s, %s, %s, %s)
                on conflict (bucket_id, object_path) do update
                set kind = excluded.kind,
                    content_type = excluded.content_type,
                    byte_size = excluded.byte_size,
                    sha256 = excluded.sha256
                """,
                (
                    audit_id,
                    kind,
                    object_path,
                    content_type,
                    byte_size,
                    sha256_digest,
                ),
            )

    def record_snapshot(self, audit_id: str, snapshot: dict[str, Any]) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                insert into public.audit_snapshots (audit_id, version, snapshot)
                select %s, coalesce(max(version), 0) + 1, %s::jsonb
                from public.audit_snapshots
                where audit_id = %s
                on conflict (audit_id, version) do nothing
                """,
                (
                    audit_id,
                    json.dumps(snapshot, default=_json_default),
                    audit_id,
                ),
            )


def _evidence_object(value: str) -> dict[str, Any]:
    try:
        decoded = json.loads(value)
        return decoded if isinstance(decoded, dict) else {"value": decoded}
    except (TypeError, json.JSONDecodeError):
        return {"value": value}


def _finding_title(issue_type: str) -> str:
    return issue_type.replace("_", " ").strip().title()


def _finding_description(finding: Finding) -> str:
    location = finding.page_url or finding.resource_url or "the crawled site"
    return f"{_finding_title(finding.issue_type)} detected at {location}."


def _json_default(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "value"):
        return value.value
    return str(value)
