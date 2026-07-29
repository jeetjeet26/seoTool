"""Private Supabase Storage uploads for audit and tool artifacts."""

from __future__ import annotations

import hashlib
import mimetypes
from pathlib import Path
from urllib.parse import quote

import requests

from worker.repository import WorkerRepository


class ArtifactUploadError(RuntimeError):
    """Raised when an artifact cannot be persisted safely."""


class _StorageClient:
    """Shared low-level Supabase Storage transport."""

    def __init__(self, supabase_url: str, service_role_key: str, timeout: int = 120):
        self.supabase_url = supabase_url.rstrip("/")
        self.service_role_key = service_role_key
        self.timeout = timeout

    def _headers(self, content_type: str | None = None) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.service_role_key}",
            "apikey": self.service_role_key,
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def put_object(
        self, bucket: str, object_path: str, content: bytes, content_type: str
    ) -> None:
        encoded_path = quote(object_path, safe="/")
        endpoint = f"{self.supabase_url}/storage/v1/object/{bucket}/{encoded_path}"
        try:
            response = requests.post(
                endpoint,
                data=content,
                timeout=self.timeout,
                headers={**self._headers(content_type), "x-upsert": "true"},
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise ArtifactUploadError(
                f"Unable to upload artifact {Path(object_path).name}"
            ) from exc

    def get_object(self, bucket: str, object_path: str) -> bytes:
        encoded_path = quote(object_path, safe="/")
        endpoint = f"{self.supabase_url}/storage/v1/object/{bucket}/{encoded_path}"
        try:
            response = requests.get(
                endpoint, timeout=self.timeout, headers=self._headers()
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise ArtifactUploadError(
                f"Unable to download artifact {Path(object_path).name}"
            ) from exc
        return response.content


class ArtifactStore:
    """Audit artifact store writing to the private audit-artifacts bucket."""

    BUCKET = "audit-artifacts"

    def __init__(
        self,
        supabase_url: str,
        service_role_key: str,
        repository: WorkerRepository,
        timeout: int = 120,
    ):
        self.storage = _StorageClient(supabase_url, service_role_key, timeout)
        self.supabase_url = self.storage.supabase_url
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
        self.storage.put_object(self.BUCKET, object_path, content, content_type)

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


class ToolArtifactStore:
    """Tool-run artifact store writing to the private tool-artifacts bucket.

    Object layout: `<run-id>/input/...` for immutable uploads and
    `<run-id>/output/...` for generated artifacts.
    """

    BUCKET = "tool-artifacts"

    def __init__(
        self,
        supabase_url: str,
        service_role_key: str,
        repository,
        timeout: int = 120,
    ):
        self.storage = _StorageClient(supabase_url, service_role_key, timeout)
        self.repository = repository
        self.timeout = timeout

    def upload_output(self, run_id: str, path: Path, kind: str) -> str:
        file_path = Path(path)
        if not file_path.is_file():
            raise ArtifactUploadError(f"Artifact does not exist: {file_path.name}")

        object_path = f"{run_id}/output/{file_path.name}"
        content_type = (
            mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        )
        content = file_path.read_bytes()
        digest = hashlib.sha256(content).digest()
        self.storage.put_object(self.BUCKET, object_path, content, content_type)
        self.repository.record_artifact(
            run_id=run_id,
            kind=kind,
            object_path=object_path,
            content_type=content_type,
            byte_size=len(content),
            sha256_digest=digest,
        )
        return object_path

    def download(self, object_path: str) -> bytes:
        return self.storage.get_object(self.BUCKET, object_path)
