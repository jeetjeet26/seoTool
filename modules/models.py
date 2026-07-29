from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List


class AuditStage(str, Enum):
    VALIDATION = "validation"
    CRAWL = "crawl"
    CRAWLING = "crawl"
    NORMALIZATION = "normalization"
    NORMALIZING = "normalization"
    SEMRUSH = "semrush"
    AI = "ai"
    ENRICHMENT = "enrichment"
    EXPORT = "export"
    COMPLETE = "complete"


class AuditStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class Severity(str, Enum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass(frozen=True)
class ProgressEvent:
    audit_id: str
    stage: AuditStage
    status: AuditStatus
    message: str
    progress: int
    timestamp: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Finding:
    id: str
    category: str
    severity: Severity
    issue_type: str
    page_url: str
    resource_url: str
    evidence: str
    recommendation: str
    source_file: str
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def stable_id(self) -> str:
        return self.id


@dataclass(frozen=True)
class AuditResult:
    audit_id: str
    status: AuditStatus
    work_dir: str
    findings: List[Finding] = field(default_factory=list)
