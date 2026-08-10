import csv
import hashlib
import json
import re
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence
from urllib.parse import urlparse

from modules.crawler import Crawler
from modules.models import (
    AuditResult,
    AuditStage,
    AuditStatus,
    Finding,
    ProgressEvent,
    Severity,
)
from modules.url_safety import UnsafeAuditUrl, validate_public_audit_url


ProgressCallback = Callable[[ProgressEvent], None]


class AuditInputError(ValueError):
    """Raised when an audit request is unsafe or incomplete."""


class AuditService:
    """Runs one isolated audit and converts crawler exports to findings."""

    _EXPORTS = (
        {
            "names": ("response_codes_client_error_4xx",),
            "category": "response_codes",
            "severity": Severity.HIGH,
            "issue_type": "client_error_4xx",
            "recommendation": "Update or remove links to the unavailable resource.",
            "kind": "link",
        },
        {
            "names": ("response_codes_redirection_3xx",),
            "category": "response_codes",
            "severity": Severity.MEDIUM,
            "issue_type": "redirection_3xx",
            "recommendation": "Link directly to the final destination where practical.",
            "kind": "redirect",
        },
        {
            "names": ("response_codes_server_error_5xx",),
            "category": "response_codes",
            "severity": Severity.CRITICAL,
            "issue_type": "server_error_5xx",
            "recommendation": "Restore the unavailable page or remove links to it.",
            "kind": "link",
        },
        {
            "names": ("response_codes_no_response",),
            "category": "response_codes",
            "severity": Severity.HIGH,
            "issue_type": "no_response",
            "recommendation": "Investigate the failed request and restore a crawlable response.",
            "kind": "link",
        },
        {
            "names": ("images_missing_alt_text",),
            "category": "images",
            "severity": Severity.MEDIUM,
            "issue_type": "missing_alt_text",
            "recommendation": "Add concise, descriptive alternative text.",
            "kind": "image",
        },
        {
            "names": ("images_missing_alt_attribute",),
            "category": "images",
            "severity": Severity.HIGH,
            "issue_type": "missing_alt_attribute",
            "recommendation": "Add an alt attribute; use an empty value only for decorative images.",
            "kind": "image",
        },
        {
            "names": ("images_over_x_kb", "images_over_100_kb"),
            "category": "images",
            "severity": Severity.LOW,
            "issue_type": "image_over_100_kb",
            "recommendation": "Compress and appropriately size the image.",
            "kind": "image",
        },
        {
            "names": ("page_titles_missing", "page_title_missing"),
            "category": "metadata",
            "severity": Severity.HIGH,
            "issue_type": "missing_title",
            "recommendation": "Add a unique, descriptive title element.",
            "kind": "page",
        },
        {
            "names": (
                "meta_description_missing",
                "meta_descriptions_missing",
                "meta_description_1_missing",
            ),
            "category": "metadata",
            "severity": Severity.MEDIUM,
            "issue_type": "missing_meta_description",
            "recommendation": "Add a useful, page-specific meta description.",
            "kind": "page",
        },
        {
            "names": ("page_titles_duplicate",),
            "category": "metadata",
            "severity": Severity.HIGH,
            "issue_type": "duplicate_title",
            "recommendation": "Write a unique title for each indexable page.",
            "kind": "page",
        },
        {
            "names": ("page_titles_below_x_characters",),
            "category": "metadata",
            "severity": Severity.LOW,
            "issue_type": "short_title",
            "recommendation": "Expand the title only when additional descriptive context is useful.",
            "kind": "page",
        },
        {
            "names": ("page_titles_over_x_characters", "page_titles_over_60_characters"),
            "category": "metadata",
            "severity": Severity.MEDIUM,
            "issue_type": "long_title",
            "recommendation": "Revise the title to the approved style and keep it under 60 characters.",
            "kind": "page",
        },
        {
            "names": ("meta_description_duplicate",),
            "category": "metadata",
            "severity": Severity.MEDIUM,
            "issue_type": "duplicate_meta_description",
            "recommendation": "Write a unique description that reflects the page's intent.",
            "kind": "page",
        },
        {
            "names": (
                "meta_description_over_x_characters",
                "meta_description_over_155_characters",
            ),
            "category": "metadata",
            "severity": Severity.LOW,
            "issue_type": "long_meta_description",
            "recommendation": "Tighten the description to 130-155 characters.",
            "kind": "page",
        },
        {
            "names": ("h1_missing",),
            "category": "headings",
            "severity": Severity.MEDIUM,
            "issue_type": "missing_h1",
            "recommendation": "Add one descriptive primary heading.",
            "kind": "page",
        },
        {
            "names": ("h1_multiple",),
            "category": "headings",
            "severity": Severity.LOW,
            "issue_type": "multiple_h1",
            "recommendation": "Review the heading hierarchy and use one primary H1.",
            "kind": "page",
        },
        {
            "names": ("h1_duplicate",),
            "category": "headings",
            "severity": Severity.MEDIUM,
            "issue_type": "duplicate_h1",
            "recommendation": "Use a page-specific H1 aligned to its approved target.",
            "kind": "page",
        },
        {
            "names": ("h2_missing",),
            "category": "headings",
            "severity": Severity.INFO,
            "issue_type": "missing_h2",
            "recommendation": "Add supporting H2 headings when the page structure benefits from them.",
            "kind": "page",
        },
        {
            "names": ("h2_multiple",),
            "category": "headings",
            "severity": Severity.INFO,
            "issue_type": "multiple_h2",
            "recommendation": "Review repeated H2 text and clarify the page hierarchy.",
            "kind": "page",
        },
        {
            "names": ("canonicals_missing", "canonical_missing"),
            "category": "canonicalization",
            "severity": Severity.MEDIUM,
            "issue_type": "missing_canonical",
            "recommendation": "Add an appropriate canonical link element.",
            "kind": "page",
        },
        {
            "names": ("canonicals_multiple",),
            "category": "canonicalization",
            "severity": Severity.HIGH,
            "issue_type": "multiple_canonicals",
            "recommendation": "Keep one valid canonical link element per page.",
            "kind": "page",
        },
        {
            "names": ("canonicals_canonicalised",),
            "category": "canonicalization",
            "severity": Severity.INFO,
            "issue_type": "canonicalised",
            "recommendation": "Confirm the canonical destination is intentional and indexable.",
            "kind": "page",
        },
        {
            "names": ("directives_noindex",),
            "category": "indexing",
            "severity": Severity.MEDIUM,
            "issue_type": "noindex",
            "recommendation": "Confirm the page is intentionally excluded from search.",
            "kind": "page",
        },
        {
            "names": ("content_low_content_pages",),
            "category": "content",
            "severity": Severity.MEDIUM,
            "issue_type": "low_content",
            "recommendation": "Review whether the page sufficiently serves its search intent.",
            "kind": "page",
        },
        {
            "names": ("content_exact_duplicates",),
            "category": "content",
            "severity": Severity.HIGH,
            "issue_type": "exact_duplicate_content",
            "recommendation": "Consolidate, canonicalize, or differentiate duplicate pages.",
            "kind": "page",
        },
        {
            "names": ("security_mixed_content",),
            "category": "security",
            "severity": Severity.HIGH,
            "issue_type": "mixed_content",
            "recommendation": "Load every page resource over HTTPS.",
            "kind": "link",
        },
    )

    _SECURITY_EXPORTS = {
        "security_missing_hsts": ("missing_hsts", "Add a Strict-Transport-Security header."),
        "security_missing_hsts_header": (
            "missing_hsts",
            "Add a Strict-Transport-Security header.",
        ),
        "security_missing_x_frame_options_header": (
            "missing_x_frame_options",
            "Add an X-Frame-Options header or equivalent CSP frame-ancestors policy.",
        ),
        "security_missing_x_frame_options": (
            "missing_x_frame_options",
            "Add an X-Frame-Options header or equivalent CSP frame-ancestors policy.",
        ),
        "security_missing_x_content_type_options_header": (
            "missing_x_content_type_options",
            "Add X-Content-Type-Options: nosniff.",
        ),
        "security_missing_x_content_type_options": (
            "missing_x_content_type_options",
            "Add X-Content-Type-Options: nosniff.",
        ),
        "security_missing_secure_referrer_policy_header": (
            "missing_referrer_policy",
            "Add a restrictive Referrer-Policy header.",
        ),
        "security_missing_referrer_policy_header": (
            "missing_referrer_policy",
            "Add a restrictive Referrer-Policy header.",
        ),
        "security_missing_content_security_policy_header": (
            "missing_content_security_policy",
            "Define and deploy an appropriate Content-Security-Policy header.",
        ),
        "security_missing_content_security_policy": (
            "missing_content_security_policy",
            "Define and deploy an appropriate Content-Security-Policy header.",
        ),
    }

    def __init__(
        self,
        crawler: Optional[Crawler] = None,
        progress_callback: Optional[ProgressCallback] = None,
    ):
        self.crawler = crawler or Crawler()
        self.progress_callback = progress_callback

    def run_audit(
        self,
        audit_id: str,
        url: str,
        city: str,
        work_dir,
        progress_callback: Optional[ProgressCallback] = None,
        finalize: bool = True,
    ) -> AuditResult:
        callback = progress_callback or self.progress_callback
        stage = AuditStage.VALIDATION
        self._validate_inputs(audit_id, url, city, work_dir)
        audit_dir = Path(work_dir).expanduser().resolve() / audit_id
        crawl_dir = audit_dir / "crawl"

        try:
            crawl_dir.mkdir(parents=True, exist_ok=True)
            self._emit(callback, audit_id, stage, AuditStatus.RUNNING, 5, "Inputs validated")

            stage = AuditStage.CRAWL
            self._emit(callback, audit_id, stage, AuditStatus.RUNNING, 15, "Crawl started")
            self.crawler.run_crawl(url, str(crawl_dir))
            self._emit(callback, audit_id, stage, AuditStatus.COMPLETED, 65, "Crawl completed")

            stage = AuditStage.NORMALIZATION
            self._emit(
                callback, audit_id, stage, AuditStatus.RUNNING, 70, "Normalizing exports"
            )
            findings = self.normalize_findings(crawl_dir)
            self._emit(
                callback,
                audit_id,
                stage,
                AuditStatus.COMPLETED,
                80 if not finalize else 85,
                f"Normalized {len(findings)} crawler findings",
            )

            if not finalize:
                return AuditResult(
                    audit_id=audit_id,
                    status=AuditStatus.RUNNING,
                    work_dir=str(audit_dir),
                    findings=findings,
                )

            stage = AuditStage.SEMRUSH
            self._emit(
                callback, audit_id, stage, AuditStatus.RUNNING, 88, "Semrush stage started"
            )
            findings.extend(self.get_semrush_findings(url=url, city=city))
            self._emit(
                callback,
                audit_id,
                stage,
                AuditStatus.COMPLETED,
                91,
                "Semrush stage completed",
            )
            stage = AuditStage.AI
            self._emit(
                callback, audit_id, stage, AuditStatus.RUNNING, 93, "AI stage started"
            )
            findings.extend(self.get_ai_findings(url=url, city=city, findings=findings))
            self._emit(
                callback, audit_id, stage, AuditStatus.COMPLETED, 97, "AI stage completed"
            )

            result = AuditResult(
                audit_id=audit_id,
                status=AuditStatus.COMPLETED,
                work_dir=str(audit_dir),
                findings=findings,
            )
            self._emit(
                callback,
                audit_id,
                AuditStage.COMPLETE,
                AuditStatus.COMPLETED,
                100,
                f"Audit completed with {len(findings)} findings",
                {"finding_count": len(findings)},
            )
            return result
        except Exception as exc:
            self._emit(
                callback,
                audit_id,
                stage,
                AuditStatus.FAILED,
                100,
                f"Audit failed: {exc}",
            )
            raise

    def run(self, audit_id: str, url: str, city: str, work_dir, **kwargs) -> AuditResult:
        """Worker-friendly alias for run_audit."""
        return self.run_audit(audit_id, url, city, work_dir, **kwargs)

    def normalize_findings(self, crawl_dir) -> List[Finding]:
        directory = Path(crawl_dir)
        if not directory.is_dir():
            raise AuditInputError(f"crawl directory does not exist: {directory}")

        files = self._index_csv_files(directory)
        findings: List[Finding] = []
        for export in self._EXPORTS:
            path = self._find_export(files, export["names"])
            if path:
                findings.extend(self._normalize_file(path, export))

        for stem, (issue_type, recommendation) in self._SECURITY_EXPORTS.items():
            path = files.get(self._filename_key(stem))
            if path:
                findings.extend(
                    self._normalize_file(
                        path,
                        {
                            "category": "security",
                            "severity": Severity.HIGH,
                            "issue_type": issue_type,
                            "recommendation": recommendation,
                            "kind": "security",
                        },
                    )
                )
        return findings

    def normalize_csvs(self, crawl_dir) -> List[Finding]:
        """Compatibility alias for callers that describe exports as CSVs."""
        return self.normalize_findings(crawl_dir)

    def get_semrush_findings(self, url: str, city: str) -> List[Finding]:
        """Extension point for a future Semrush adapter."""
        return []

    def get_ai_findings(
        self, url: str, city: str, findings: Sequence[Finding]
    ) -> List[Finding]:
        """Extension point for future AI-assisted analysis."""
        return []

    @staticmethod
    def _validate_inputs(audit_id: str, url: str, city: str, work_dir) -> None:
        if not isinstance(audit_id, str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", audit_id
        ):
            raise AuditInputError(
                "audit_id must be 1-128 safe filename characters and start alphanumeric"
            )
        if audit_id in {".", ".."}:
            raise AuditInputError("audit_id cannot be a relative path")
        if not isinstance(city, str) or not city.strip() or len(city.strip()) > 200:
            raise AuditInputError("city must be a non-empty string up to 200 characters")
        if not isinstance(url, str) or len(url) > 2048 or url != url.strip():
            raise AuditInputError("url must be a valid absolute HTTP(S) URL")
        parsed = urlparse(url)
        try:
            port = parsed.port
        except ValueError as exc:
            raise AuditInputError("url contains an invalid port") from exc
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or port is not None and not 1 <= port <= 65535
        ):
            raise AuditInputError(
                "url must be an absolute HTTP(S) URL without credentials"
            )
        try:
            validate_public_audit_url(url)
        except UnsafeAuditUrl as exc:
            raise AuditInputError(str(exc)) from exc
        if not isinstance(work_dir, (str, Path)) or not str(work_dir).strip():
            raise AuditInputError("work_dir must be a non-empty path")
        path = Path(work_dir).expanduser()
        if path.exists() and not path.is_dir():
            raise AuditInputError("work_dir must be a directory")

    @staticmethod
    def _emit(
        callback: Optional[ProgressCallback],
        audit_id: str,
        stage: AuditStage,
        status: AuditStatus,
        progress: int,
        message: str,
        metadata: Optional[Dict] = None,
    ) -> None:
        if callback:
            callback(
                ProgressEvent(
                    audit_id=audit_id,
                    stage=stage,
                    status=status,
                    message=message,
                    progress=progress,
                    metadata=metadata or {},
                )
            )

    @classmethod
    def _index_csv_files(cls, directory: Path) -> Dict[str, Path]:
        return {
            cls._filename_key(path.stem): path
            for path in directory.iterdir()
            if path.is_file() and path.suffix.lower() == ".csv"
        }

    @classmethod
    def _find_export(
        cls, files: Dict[str, Path], names: Iterable[str]
    ) -> Optional[Path]:
        for name in names:
            path = files.get(cls._filename_key(name))
            if path:
                return path
        return None

    @staticmethod
    def _filename_key(name: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")

    def _normalize_file(self, path: Path, export: Dict) -> List[Finding]:
        findings = []
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            for raw_row in reader:
                row = {
                    self._column_key(key): (value or "").strip()
                    for key, value in raw_row.items()
                    if key is not None
                }
                page_url, resource_url = self._urls_for_row(row, export["kind"])
                evidence = self._evidence_for_row(row, export["issue_type"])
                finding_id = self._stable_id(
                    export["category"],
                    export["issue_type"],
                    page_url,
                    resource_url,
                    evidence,
                )
                findings.append(
                    Finding(
                        id=finding_id,
                        category=export["category"],
                        severity=export["severity"],
                        issue_type=export["issue_type"],
                        page_url=page_url,
                        resource_url=resource_url,
                        evidence=evidence,
                        recommendation=export["recommendation"],
                        source_file=path.name,
                        metadata={"crawler_row": row},
                    )
                )
        return findings

    @staticmethod
    def _column_key(name: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")

    @staticmethod
    def _urls_for_row(row: Dict[str, str], kind: str):
        address = row.get("address", "")
        source = row.get("source", "")
        if kind in {"link", "image"}:
            return source or address, address
        if kind == "redirect":
            return address, row.get("redirect_uri", "") or row.get("destination", "")
        return address or source, ""

    @staticmethod
    def _evidence_for_row(row: Dict[str, str], issue_type: str) -> str:
        preferred = (
            "status_code",
            "status",
            "redirect_uri",
            "h1_1",
            "h1_2",
            "h1_count",
            "content_type",
        )
        details = {key: row[key] for key in preferred if row.get(key)}
        details["issue"] = issue_type
        return json.dumps(details, sort_keys=True, separators=(",", ":"))

    @staticmethod
    def _stable_id(*parts: str) -> str:
        identity = "\x1f".join(str(part).strip() for part in parts)
        return hashlib.sha256(identity.encode("utf-8")).hexdigest()
