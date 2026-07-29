"""Environment-backed settings for the Render audit worker."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


class WorkerConfigurationError(RuntimeError):
    """Raised when required worker configuration is missing or invalid."""


@dataclass(frozen=True)
class WorkerSettings:
    database_url: str
    supabase_url: str
    supabase_service_role_key: str
    worker_id: str
    poll_seconds: float
    work_root: Path

    @classmethod
    def from_env(cls) -> "WorkerSettings":
        database_url = os.getenv("SUPABASE_DB_URL", "").strip()
        supabase_url = (
            os.getenv("SUPABASE_URL")
            or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
            or ""
        ).strip()
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

        missing = [
            name
            for name, value in {
                "SUPABASE_DB_URL": database_url,
                "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL": supabase_url,
                "SUPABASE_SERVICE_ROLE_KEY": service_key,
                "SEMRUSH_API_KEY": os.getenv("SEMRUSH_API_KEY", "").strip(),
                "ANTHROPIC_API_KEY": os.getenv("ANTHROPIC_API_KEY", "").strip(),
            }.items()
            if not value
        ]
        if missing:
            raise WorkerConfigurationError(
                "Missing worker environment variables: " + ", ".join(missing)
            )

        try:
            poll_seconds = float(os.getenv("WORKER_POLL_SECONDS", "5"))
        except ValueError as exc:
            raise WorkerConfigurationError(
                "WORKER_POLL_SECONDS must be a number"
            ) from exc
        if poll_seconds < 1:
            raise WorkerConfigurationError("WORKER_POLL_SECONDS must be at least 1")

        work_root = Path(
            os.getenv("AUDIT_WORK_ROOT", "/tmp/seo-audits")
        ).expanduser()

        return cls(
            database_url=database_url,
            supabase_url=supabase_url.rstrip("/"),
            supabase_service_role_key=service_key,
            worker_id=os.getenv("WORKER_ID", "seo-audit-worker-1").strip()
            or "seo-audit-worker-1",
            poll_seconds=poll_seconds,
            work_root=work_root,
        )
