"""Private Supabase Storage uploads for audit artifacts."""

from __future__ import annotations

import hashlib
import mimetypes
from pathlib import Path
from urllib.parse import quote

import requests

from worker.repository import WorkerRepository


class ArtifactUploadError(RuntimeError):
    """Raised when an artifact cannot be persisted safely."""


class ArtifactStore:
    BUCKET = "audit-artifacts"

    def __init__(
        self,
        supabase_url: str,
        service_role_key: str,
        repository: WorkerRepository,
        timeout: int = 120,
    ):
        self.supabase_url = supabase_url.rstrip("/")
        self.service_role_key = service_role_key
        self.repository = repository
        self.timeout = timeout

    def upload_file(self, audit_id: str, path: Path, kind: str) -> str:
        file_path = Path(path)
        if not file_path.is_file():
            raise ArtifactUploadError(f"Artifact does not exist: {file_path.name}")

        object_path = f"{audit_id}/{kind}/{file_path.name}"
        content_type = (
            mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        )
        content = file_path.read_bytes()
        digest = hashlib.sha256(content).digest()
        encoded_path = quote(object_path, safe="/")
        endpoint = (
            f"{self.supabase_url}/storage/v1/object/{self.BUCKET}/{encoded_path}"
        )

        try:
            response = requests.post(
                endpoint,
                data=content,
                timeout=self.timeout,
                headers={
                    "Authorization": f"Bearer {self.service_role_key}",
                    "apikey": self.service_role_key,
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise ArtifactUploadError(
                f"Unable to upload artifact {file_path.name}"
            ) from exc

        self.repository.record_artifact(
            audit_id=audit_id,
            kind=kind,
            object_path=object_path,
            content_type=content_type,
            byte_size=len(content),
            sha256_digest=digest,
        )
        return object_path

    def upload_crawl_exports(self, audit_id: str, crawl_dir: Path) -> list[str]:
        uploaded = []
        for path in sorted(Path(crawl_dir).glob("*.csv")):
            uploaded.append(self.upload_file(audit_id, path, "crawl-export"))
        return uploaded
