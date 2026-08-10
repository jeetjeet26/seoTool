import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type {
  Audit,
  AuditEvent,
  AuditStatus,
  AuditSummary,
  Client,
  DataProvider,
  Finding,
  Task,
  ToolArtifact,
  ToolRun,
  ToolRunItem,
} from "./types";

type ClientRow = {
  id: string;
  name: string;
  website_url: string;
  notes: string | null;
  audits?: Array<{ id: string; status: string }>;
};

type AuditRow = {
  id: string;
  client_id: string;
  target_url: string;
  status: string;
  current_stage: string;
  progress: number;
  page_limit: number;
  summary: AuditSummary | null;
  created_at: string;
  updated_at: string;
  failure_message: string | null;
  published_at: string | null;
  clients?: { name: string } | null;
};

type FindingRow = {
  id: string;
  category: string;
  rule_key: string;
  severity: string;
  status: Finding["status"];
  title: string;
  page_url: string | null;
  resource_url: string | null;
  recommendation: string;
};

type TaskRow = {
  id: string;
  audit_id: string;
  finding_id: string | null;
  title: string;
  description: string | null;
  status: Task["status"];
  priority: Task["priority"];
  is_client_visible: boolean;
  due_at: string | null;
};

type ToolRunRow = {
  id: string;
  client_id: string;
  audit_id: string | null;
  tool_type: ToolRun["toolType"];
  name: string;
  status: ToolRun["status"];
  current_stage: string;
  progress: number;
  options: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
  clients?: { name: string } | null;
};

type ToolRunItemRow = {
  id: string;
  run_id: string;
  item_type: string;
  stable_key: string;
  position: number;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  edited_output: Record<string, unknown> | null;
  review_status: ToolRunItem["reviewStatus"];
};

const TOOL_RUN_COLUMNS =
  "id,client_id,audit_id,tool_type,name,status,current_stage,progress,options,summary,failure_message,created_at,updated_at,clients(name)";

function mapToolRun(row: ToolRunRow): ToolRun {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients?.name ?? "Client",
    auditId: row.audit_id ?? undefined,
    toolType: row.tool_type,
    name: row.name,
    status: row.status,
    currentStage: row.current_stage,
    progress: row.progress,
    options: row.options ?? {},
    summary: row.summary ?? {},
    failureMessage: row.failure_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function auditStatus(row: AuditRow): AuditStatus {
  if (row.published_at) return "published";
  if (row.status === "draft") return "draft";
  if (row.status === "failed") return "failed";
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "running") return "running";
  if (row.status === "completed") return "review";
  return "queued";
}

function scoreFromSummary(summary: AuditSummary | null): number | null {
  const value = summary?.score;
  return typeof value === "number" ? value : null;
}

function pagesFromSummary(
  summary: AuditSummary | null,
  fallback: number,
): number {
  const value = summary?.pages_scanned;
  return typeof value === "number" ? value : fallback;
}

function mapAudit(row: AuditRow): Audit {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients?.name ?? "Client",
    url: row.target_url,
    status: auditStatus(row),
    score: scoreFromSummary(row.summary),
    pages: pagesFromSummary(row.summary, row.page_limit),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stage: Math.min(5, Math.max(0, Math.round(row.progress / 20))),
    failedReason: row.failure_message ?? undefined,
    summary: row.summary ?? undefined,
  };
}

function mapCategory(category: string): Finding["category"] {
  const normalized = category.toLowerCase();
  if (normalized.includes("metadata")) return "Metadata";
  if (normalized.includes("content") || normalized.includes("heading")) {
    return "Content";
  }
  if (
    normalized.includes("link") ||
    normalized.includes("response") ||
    normalized.includes("redirect")
  ) {
    return "Links";
  }
  if (normalized.includes("performance")) return "Performance";
  if (normalized.includes("accessibility")) return "Accessibility";
  if (normalized.includes("security")) return "Security";
  return "Crawlability";
}

function mapSeverity(value: string): Finding["severity"] {
  const normalized = value.toLowerCase();
  if (normalized === "critical") return "Critical";
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";
  return "Info";
}

export const supabaseData: DataProvider = {
  async getClients(): Promise<Client[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("clients")
      .select("id,name,website_url,notes,audits(id,status)")
      .order("created_at", { ascending: false });
    if (error) throw error;

    return ((data ?? []) as ClientRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      website: row.website_url,
      location: row.notes ?? "",
      contact: "",
      activeAudits:
        row.audits?.filter((audit) =>
          ["queued", "running"].includes(audit.status),
        ).length ?? 0,
    }));
  },

  async getClient(id: string): Promise<Client | undefined> {
    const clients = await this.getClients();
    return clients.find((client) => client.id === id);
  },

  async getAudits(): Promise<Audit[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("audits")
      .select(
        "id,client_id,target_url,status,current_stage,progress,page_limit,summary,created_at,updated_at,failure_message,published_at,clients(name)",
      )
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as unknown as AuditRow[]).map(mapAudit);
  },

  async getAudit(id: string): Promise<Audit | undefined> {
    const audits = await this.getAudits();
    return audits.find((audit) => audit.id === id);
  },

  async getFindings(auditId: string): Promise<Finding[]> {
    const supabase = await createSupabaseServerClient();
    const rows: FindingRow[] = [];
    const batchSize = 1000;
    for (let from = 0; ; from += batchSize) {
      const { data, error } = await supabase
        .from("findings")
        .select(
          "id,category,rule_key,severity,status,title,page_url,resource_url,recommendation",
        )
        .eq("audit_id", auditId)
        .order("severity")
        .order("id")
        .range(from, from + batchSize - 1);
      if (error) throw error;
      const batch = (data ?? []) as FindingRow[];
      rows.push(...batch);
      if (batch.length < batchSize) break;
    }

    return rows.map((row) => ({
      id: row.id,
      category: mapCategory(row.category),
      severity: mapSeverity(row.severity),
      title: row.title,
      occurrences: 1,
      ruleKey: row.rule_key,
      status: row.status,
      pageUrl: row.page_url ?? "",
      resourceUrl: row.resource_url ?? undefined,
      recommendation: row.recommendation,
    }));
  },

  async getTasks(auditId: string): Promise<Task[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id,audit_id,finding_id,title,description,status,priority,is_client_visible,due_at",
      )
      .eq("audit_id", auditId)
      .order("created_at");
    if (error) throw error;

    return ((data ?? []) as TaskRow[]).map((row) => ({
      id: row.id,
      auditId: row.audit_id,
      findingId: row.finding_id ?? undefined,
      title: row.title,
      description: row.description ?? undefined,
      status: row.status,
      priority: row.priority,
      isClientVisible: row.is_client_visible,
      dueAt: row.due_at ?? undefined,
    }));
  },

  async getAuditEvents(auditId: string): Promise<AuditEvent[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("audit_events")
      .select("id,event_type,message,created_at")
      .eq("audit_id", auditId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      eventType: row.event_type,
      message: row.message ?? undefined,
      createdAt: row.created_at,
    }));
  },

  async getToolRuns(): Promise<ToolRun[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("tool_runs")
      .select(TOOL_RUN_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return ((data ?? []) as unknown as ToolRunRow[]).map(mapToolRun);
  },

  async getToolRun(id: string): Promise<ToolRun | undefined> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("tool_runs")
      .select(TOOL_RUN_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapToolRun(data as unknown as ToolRunRow) : undefined;
  },

  async getToolRunItems(runId: string): Promise<ToolRunItem[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("tool_run_items")
      .select(
        "id,run_id,item_type,stable_key,position,input,output,edited_output,review_status",
      )
      .eq("run_id", runId)
      .order("position");
    if (error) throw error;

    return ((data ?? []) as ToolRunItemRow[]).map((row) => ({
      id: row.id,
      runId: row.run_id,
      itemType: row.item_type,
      stableKey: row.stable_key,
      position: row.position,
      input: row.input ?? {},
      output: row.output ?? {},
      editedOutput: row.edited_output ?? undefined,
      reviewStatus: row.review_status,
    }));
  },

  async getToolArtifacts(runId: string): Promise<ToolArtifact[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("tool_artifacts")
      .select("id,run_id,kind,object_path,content_type,byte_size")
      .eq("run_id", runId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      runId: row.run_id,
      kind: row.kind,
      objectPath: row.object_path,
      contentType: row.content_type ?? undefined,
      byteSize: row.byte_size ?? undefined,
    }));
  },

  async getToolRunsForAudit(auditId: string): Promise<ToolRun[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("tool_runs")
      .select(TOOL_RUN_COLUMNS)
      .eq("audit_id", auditId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as unknown as ToolRunRow[]).map(mapToolRun);
  },
};
