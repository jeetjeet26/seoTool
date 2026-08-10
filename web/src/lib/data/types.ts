export type AuditStatus =
  | "queued"
  | "running"
  | "review"
  | "published"
  | "failed"
  | "cancelled";

export interface ContentRecommendation {
  url: string;
  current_title?: string;
  current_h1?: string;
  current_meta_description?: string;
  keywords?: string[];
  proposed_title?: string;
  proposed_h1?: string;
  proposed_meta_description?: string;
  proposed_content?: string;
  current_body_text?: string;
  rationale?: string;
  current_body_word_count?: number;
  requires_human_review?: boolean;
}

export interface PageExperience {
  url: string;
  performance_score?: number;
  accessibility_score?: number;
  metrics?: Record<string, { display_value?: string }>;
  accessibility_issues?: Array<{ id?: string; title?: string }>;
}

export interface KeywordStrategyItem {
  keyword: string;
  source: "approved" | "ranking" | "related" | "seed";
  volume: number;
  cpc: number;
  difficulty: number;
  competition: number;
  position?: number | null;
  intent: string;
  score: number;
  assigned_page: string;
}

export interface CompetitorMetric {
  domain: string;
  source?: "provided" | "semrush";
  competition_level: number;
  common_keywords: number;
  organic_keywords: number;
  organic_traffic: number;
}

export interface AltTextRecommendation {
  image_url: string;
  page_url: string;
  current_alt_text?: string;
  proposed_alt_text?: string;
  alt_text_length?: number;
  warnings?: string[];
}

export interface SiteInventorySummary {
  page_count?: number;
  sitemap_url_count?: number;
  sitemap_only_count?: number;
  crawl_only_count?: number;
  missing_title_count?: number;
  missing_description_count?: number;
  missing_h1_count?: number;
  duplicate_title_count?: number;
  duplicate_description_count?: number;
  images_missing_alt_count?: number;
  sitemap_errors?: string[];
}

export interface AuditSummary {
  score?: number;
  pages_scanned?: number;
  finding_count?: number;
  severity_counts?: Record<string, number>;
  category_counts?: Record<string, number>;
  target_url?: string;
  target_location?: string;
  semrush?: Record<string, unknown>;
  semrush_site_audit?: {
    project_id?: number;
    project_name?: string;
    domain?: string;
    pages_crawled?: number;
    site_health?: number;
    errors?: number;
    warnings?: number;
    notices?: number;
    thematic_scores?: Record<string, { value?: number; delta?: number }>;
  };
  property_context?: {
    name?: string;
    location?: string;
    vertical?: string;
    address?: string;
    website?: string;
  };
  report_variant?: "full_client" | "in_house";
  fair_housing_enabled?: boolean;
  competitors?: CompetitorMetric[];
  backlinks?: Record<string, number>;
  keyword_strategy?: KeywordStrategyItem[];
  keyword_metrics?: Record<string, unknown>;
  site_inventory?: SiteInventorySummary;
  content_recommendations?: ContentRecommendation[];
  alt_text_recommendations?: AltTextRecommendation[];
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
  ruleKey: string;
  status: "open" | "accepted" | "resolved" | "dismissed";
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
