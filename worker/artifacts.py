"""Private Supabase Storage uploads for audit and tool artifacts."""

from __future__ import annotations

import hashlib
import io
import mimetypes
import re
import zipfile
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
        paths = [
            *Path(crawl_dir).glob("*.csv"),
            *Path(crawl_dir).glob("*.seospider"),
        ]
        for path in sorted(paths):
            if path.stat().st_size <= 49 * 1024 * 1024:
                uploaded.append(self.upload_file(audit_id, path, "crawl-export"))
        return uploaded

    def download_crawl_imports(
        self,
        audit_id: str,
        object_paths: list[str],
        crawl_dir: Path,
    ) -> list[Path]:
        destination = Path(crawl_dir)
        destination.mkdir(parents=True, exist_ok=True)
        written: list[Path] = []
        total_bytes = 0
        for object_path in object_paths[:50]:
            if not object_path.startswith(f"{audit_id}/crawl-import/"):
                raise ArtifactUploadError("Invalid crawl import path")
            content = self.storage.get_object(self.BUCKET, object_path)
            total_bytes += len(content)
            if total_bytes > 250 * 1024 * 1024:
                raise ArtifactUploadError("Crawl import exceeds the 250 MB limit")
            if object_path.lower().endswith(".zip"):
                written.extend(
                    self._extract_csv_zip(content, destination)
                )
            elif object_path.lower().endswith(".csv"):
                raw_name = re.sub(
                    r"^[0-9a-fA-F-]{36}-",
                    "",
                    Path(object_path).name,
                )
                name = _safe_import_name(raw_name)
                path = destination / name
                path.write_bytes(content)
                written.append(path)
            else:
                raise ArtifactUploadError("Only CSV and ZIP imports are supported")
        if not (destination / "internal_all.csv").is_file():
            raise ArtifactUploadError(
                "The import must include Screaming Frog's Internal:All CSV "
                "named internal_all.csv"
            )
        return written

    @staticmethod
    def _extract_csv_zip(content: bytes, destination: Path) -> list[Path]:
        written = []
        expanded_bytes = 0
        try:
            archive = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile as exc:
            raise ArtifactUploadError("The uploaded ZIP is invalid") from exc
        members = [
            member
            for member in archive.infolist()
            if not member.is_dir()
            and member.filename.lower().endswith(".csv")
            and "__macosx" not in member.filename.lower()
        ]
        if len(members) > 200:
            raise ArtifactUploadError("The ZIP contains too many CSV files")
        for member in members:
            expanded_bytes += member.file_size
            if expanded_bytes > 250 * 1024 * 1024:
                raise ArtifactUploadError("Expanded crawl import exceeds 250 MB")
            name = _safe_import_name(Path(member.filename).name)
            path = destination / name
            path.write_bytes(archive.read(member))
            written.append(path)
        return written


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


def _safe_import_name(value: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9._() -]+", "_", value).strip()
    if not name or name in {".", ".."} or not name.lower().endswith(".csv"):
        raise ArtifactUploadError("Invalid crawl import filename")
    return name
