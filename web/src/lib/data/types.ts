export type AuditStatus =
  | "queued"
  | "running"
  | "review"
  | "published"
  | "failed"
  | "cancelled";

export interface ContentRecommendation {
  url: string;
  title?: string;
  h1?: string;
  meta_description?: string;
  proposed_title?: string;
  proposed_h1?: string;
  proposed_meta_description?: string;
  proposed_content?: string;
  requires_human_review?: boolean;
}

export interface PageExperience {
  url: string;
  performance_score?: number;
  accessibility_score?: number;
  metrics?: Record<string, { display_value?: string }>;
  accessibility_issues?: Array<{ id?: string; title?: string }>;
}

export interface AuditSummary {
  score?: number;
  pages_scanned?: number;
  finding_count?: number;
  severity_counts?: Record<string, number>;
  category_counts?: Record<string, number>;
  semrush?: Record<string, unknown>;
  keyword_metrics?: Record<string, unknown>;
  content_recommendations?: ContentRecommendation[];
  page_experience?: PageExperience[];
  enrichment_errors?: Array<{ service: string; message: string }>;
}

export interface Client {
  id: string;
  name: string;
  website: string;
  location: string;
  contact: string;
  activeAudits: number;
}

export interface Audit {
  id: string;
  clientId: string;
  clientName: string;
  url: string;
  status: AuditStatus;
  score: number | null;
  pages: number;
  createdAt: string;
  updatedAt: string;
  stage: number;
  failedReason?: string;
  summary?: AuditSummary;
}

export interface Finding {
  id: string;
  category:
    | "Crawlability"
    | "Metadata"
    | "Content"
    | "Links"
    | "Performance"
    | "Accessibility"
    | "Security";
  severity: "Critical" | "High" | "Medium" | "Low" | "Info";
  title: string;
  occurrences: number;
  pageUrl: string;
  resourceUrl?: string;
  recommendation: string;
}

export interface Task {
  id: string;
  auditId: string;
  findingId?: string;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  isClientVisible: boolean;
  dueAt?: string;
}

export interface AuditEvent {
  id: string;
  eventType: string;
  message?: string;
  createdAt: string;
}

export type ToolType =
  | "keyword_research"
  | "bulk_metadata"
  | "one_off_metadata"
  | "schema_generation"
  | "llms_txt"
  | "local_audit"
  | "listing_optimization";

export type ToolRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ToolItemReview = "unreviewed" | "approved" | "rejected";

export interface ToolRun {
  id: string;
  clientId: string;
  clientName: string;
  auditId?: string;
  toolType: ToolType;
  name: string;
  status: ToolRunStatus;
  currentStage: string;
  progress: number;
  options: Record<string, unknown>;
  summary: Record<string, unknown>;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRunItem {
  id: string;
  runId: string;
  itemType: string;
  stableKey: string;
  position: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  editedOutput?: Record<string, unknown>;
  reviewStatus: ToolItemReview;
}

export interface ToolArtifact {
  id: string;
  runId: string;
  kind: string;
  objectPath: string;
  contentType?: string;
  byteSize?: number;
}

export interface DataProvider {
  getClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  getAudits(): Promise<Audit[]>;
  getAudit(id: string): Promise<Audit | undefined>;
  getFindings(auditId: string): Promise<Finding[]>;
  getTasks(auditId: string): Promise<Task[]>;
  getAuditEvents(auditId: string): Promise<AuditEvent[]>;
  getToolRuns(): Promise<ToolRun[]>;
  getToolRun(id: string): Promise<ToolRun | undefined>;
  getToolRunItems(runId: string): Promise<ToolRunItem[]>;
  getToolArtifacts(runId: string): Promise<ToolArtifact[]>;
  getToolRunsForAudit(auditId: string): Promise<ToolRun[]>;
}
