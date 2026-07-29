"""Direct Postgres repository for trusted tool-run workers."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row

SUPPORTED_TOOL_TYPES = (
    "keyword_research",
    "bulk_metadata",
    "one_off_metadata",
    "schema_generation",
    "llms_txt",
    "local_audit",
    "listing_optimization",
)


@dataclass(frozen=True)
class ToolRunJob:
    id: str
    client_id: str
    audit_id: str | None
    tool_type: str
    name: str
    options: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolRunItem:
    item_type: str
    stable_key: str
    position: int
    input: dict[str, Any] = field(default_factory=dict)
    output: dict[str, Any] = field(default_factory=dict)


class ToolRepository:
    def __init__(self, database_url: str, worker_id: str):
        self.database_url = database_url
        self.worker_id = worker_id

    def _connect(self):
        return psycopg.connect(self.database_url, row_factory=dict_row)

    def claim_next_run(
        self, supported_types: Iterable[str] = SUPPORTED_TOOL_TYPES
    ) -> ToolRunJob | None:
        types = list(supported_types)
        with self._connect() as connection:
            row = connection.execute(
                "select * from private.claim_tool_run(%s, %s::public.tool_type[])",
                (self.worker_id, types),
            ).fetchone()
        if not row:
            return None
        return ToolRunJob(
            id=str(row["id"]),
            client_id=str(row["client_id"]),
            audit_id=str(row["audit_id"]) if row.get("audit_id") else None,
            tool_type=row["tool_type"],
            name=row["name"],
            options=row.get("options") or {},
        )

    def heartbeat(self, run_id: str) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                "select private.heartbeat_tool_run(%s, %s) as accepted",
                (run_id, self.worker_id),
            ).fetchone()
        return bool(row and row["accepted"])

    def get_client_context(self, client_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "select name, website_url, notes, intake from public.clients where id = %s",
                (client_id,),
            ).fetchone()
        if not row:
            return {}
        return {
            "name": row["name"],
            "website_url": row["website_url"],
            "notes": row.get("notes") or "",
            "intake": row.get("intake") or {},
        }

    def record_progress(
        self,
        run_id: str,
        stage: str,
        progress: int,
        message: str = "",
        payload: dict[str, Any] | None = None,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                update public.tool_runs
                set current_stage = %s, progress = %s
                where id = %s and claimed_by = %s
                """,
                (stage, max(0, min(100, progress)), run_id, self.worker_id),
            )
            connection.execute(
                """
                insert into public.tool_run_events (run_id, event_type, message, payload)
                values (%s, %s, %s, %s::jsonb)
                """,
                (
                    run_id,
                    f"tool.{stage}",
                    message,
                    json.dumps(payload or {}, default=_json_default),
                ),
            )

    def replace_items(self, run_id: str, items: Iterable[ToolRunItem]) -> int:
        rows = list(items)
        with self._connect() as connection:
            for item in rows:
                connection.execute(
                    """
                    insert into public.tool_run_items (
                      run_id, item_type, stable_key, position, input, output
                    )
                    values (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
                    on conflict (run_id, stable_key) do update
                    set item_type = excluded.item_type,
                        position = excluded.position,
                        input = excluded.input,
                        output = excluded.output,
                        updated_at = now()
                    """,
                    (
                        run_id,
                        item.item_type,
                        item.stable_key,
                        item.position,
                        json.dumps(item.input, default=_json_default),
                        json.dumps(item.output, default=_json_default),
                    ),
                )
        return len(rows)

    def get_input_artifact(self, run_id: str, kind: str) -> str | None:
        """Returns the object path of the most recent input artifact of a kind."""
        with self._connect() as connection:
            row = connection.execute(
                """
                select object_path
                from public.tool_artifacts
                where run_id = %s and kind = %s
                order by created_at desc
                limit 1
                """,
                (run_id, kind),
            ).fetchone()
        return row["object_path"] if row else None

    def record_artifact(
        self,
        run_id: str,
        kind: str,
        object_path: str,
        content_type: str,
        byte_size: int,
        sha256_digest: bytes,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                insert into public.tool_artifacts (
                  run_id, kind, object_path, content_type, byte_size, sha256
                )
                values (%s, %s, %s, %s, %s, %s)
                on conflict (bucket_id, object_path) do update
                set kind = excluded.kind,
                    content_type = excluded.content_type,
                    byte_size = excluded.byte_size,
                    sha256 = excluded.sha256
                """,
                (run_id, kind, object_path, content_type, byte_size, sha256_digest),
            )

    def complete_run(self, run_id: str, summary: dict[str, Any]) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                update public.tool_runs
                set status = 'completed',
                    current_stage = 'review',
                    progress = 100,
                    completed_at = now(),
                    heartbeat_at = now(),
                    summary = %s::jsonb,
                    failure_message = null
                where id = %s and claimed_by = %s
                """,
                (json.dumps(summary, default=_json_default), run_id, self.worker_id),
            )

    def fail_run(self, run_id: str, message: str) -> None:
        safe_message = (message or "Tool run failed")[:4000]
        with self._connect() as connection:
            connection.execute(
                """
                update public.tool_runs
                set status = 'failed',
                    current_stage = 'failed',
                    completed_at = now(),
                    heartbeat_at = now(),
                    failure_message = %s
                where id = %s and claimed_by = %s
                """,
                (safe_message, run_id, self.worker_id),
            )
            connection.execute(
                """
                insert into public.tool_run_events (run_id, event_type, message, payload)
                values (%s, 'tool.failed', %s, '{}'::jsonb)
                """,
                (run_id, safe_message),
            )


def _json_default(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "value"):
        return value.value
    return str(value)
