import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import postgres from "postgres";

import { isShareBackendConfigured } from "@/lib/config";
import type { AuditSummary, Finding } from "@/lib/data/types";
import type { PortalPayload, PortalTask } from "@/lib/share/types";

interface PortalSession {
  auditId: string;
  tokenHash: string;
  expiresAt: number;
  nonce: string;
}

let databaseClient: ReturnType<typeof postgres> | undefined;

function database() {
  if (!process.env.SUPABASE_DB_URL) {
    throw new Error("SUPABASE_DB_URL is not configured");
  }
  databaseClient ??= postgres(process.env.SUPABASE_DB_URL, {
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return databaseClient;
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createPortalSession(auditId: string, token: string): string {
  const secret = process.env.SHARE_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SHARE_SESSION_SECRET must be at least 32 characters");
  }
  const session: PortalSession = {
    auditId,
    tokenHash: hashShareToken(token),
    expiresAt: Date.now() + 30 * 60 * 1000,
    nonce: randomBytes(16).toString("hex"),
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyPortalSession(
  value: string | undefined,
  token: string,
): PortalSession | null {
  const secret = process.env.SHARE_SESSION_SECRET;
  if (!value || !secret || secret.length < 32) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as PortalSession;
    if (
      session.expiresAt <= Date.now() ||
      session.tokenHash !== hashShareToken(token)
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function validateTokenAndPin(
  token: string,
  pin: string,
): Promise<string | null> {
  if (!isShareBackendConfigured) return null;
  const sql = database();
  const rows = await sql<{ audit_id: string | null }[]>`
    select private.validate_share_access(${token}, ${pin})::text as audit_id
  `;
  return rows[0]?.audit_id ?? null;
}

export async function createShareLink(
  auditId: string,
  token: string,
  pin: string,
  expiresAt: Date,
  actorId: string,
): Promise<string> {
  const sql = database();
  const rows = await sql<Array<{ link_id: string }>>`
    select private.create_share_link(
      ${auditId}::uuid,
      ${token},
      ${pin},
      ${expiresAt.toISOString()}::timestamptz,
      ${actorId}::uuid
    )::text as link_id
  `;
  if (!rows[0]?.link_id) throw new Error("Share link was not created");
  return rows[0].link_id;
}

export async function loadPortal(auditId: string): Promise<PortalPayload | null> {
  const sql = database();
  const audits = await sql<
    Array<{
      audit_id: string;
      client_name: string;
      report_name: string;
      summary: Record<string, unknown>;
    }>
  >`
    select
      a.id::text as audit_id,
      c.name as client_name,
      a.name as report_name,
      a.summary
    from public.audits a
    join public.clients c on c.id = a.client_id
    where a.id = ${auditId}::uuid
      and a.published_at is not null
    limit 1
  `;
  const audit = audits[0];
  if (!audit) return null;

  const taskRows = await sql<
    Array<{
      id: string;
      title: string;
      status: PortalTask["status"];
      priority: PortalTask["priority"];
      due_at: string | null;
    }>
  >`
    select id::text, title, status, priority, due_at::text
    from public.tasks
    where audit_id = ${auditId}::uuid
      and is_client_visible
      and published_at is not null
    order by
      case priority
        when 'urgent' then 1
        when 'high' then 2
        when 'medium' then 3
        else 4
      end,
      created_at
  `;
  const tasks = taskRows.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueAt: task.due_at,
  }));
  const findingRows = await sql<
    Array<{
      id: string;
      category: string;
      rule_key: string;
      severity: string;
      status: Finding["status"];
      title: string;
      page_url: string | null;
      resource_url: string | null;
      recommendation: string;
    }>
  >`
    select
      id::text,
      category,
      rule_key,
      severity,
      status,
      title,
      page_url,
      resource_url,
      recommendation
    from public.findings
    where audit_id = ${auditId}::uuid
    order by
      case severity
        when 'critical' then 1
        when 'high' then 2
        when 'medium' then 3
        when 'low' then 4
        else 5
      end,
      title,
      page_url
  `;
  const findings: Finding[] = findingRows.map((finding) => ({
    id: finding.id,
    category: mapFindingCategory(finding.category),
    ruleKey: finding.rule_key,
    severity: mapFindingSeverity(finding.severity),
    status: finding.status,
    title: finding.title,
    occurrences: 1,
    pageUrl: finding.page_url ?? "",
    resourceUrl: finding.resource_url ?? undefined,
    recommendation: finding.recommendation,
  }));
  const score =
    typeof audit.summary?.score === "number" ? audit.summary.score : null;

  return {
    auditId: audit.audit_id,
    clientName: audit.client_name,
    reportName: audit.report_name,
    score,
    completedTasks: tasks.filter((task) => task.status === "done").length,
    totalTasks: tasks.length,
    tasks,
    summary: (audit.summary ?? {}) as AuditSummary,
    findings,
  };
}

export async function updatePortalFindings(
  auditId: string,
  findingIds: string[],
  status: "open" | "resolved",
): Promise<number> {
  const sql = database();
  const rows = await sql<Array<{ id: string }>>`
    update public.findings
    set
      status = ${status},
      resolved_at = ${status === "resolved" ? new Date().toISOString() : null}
    where audit_id = ${auditId}::uuid
      and id in ${sql(findingIds)}
    returning id::text
  `;
  return rows.length;
}

function mapFindingCategory(category: string): Finding["category"] {
  const normalized = category.toLowerCase();
  if (normalized.includes("metadata")) return "Metadata";
  if (normalized.includes("content") || normalized.includes("heading")) return "Content";
  if (
    normalized.includes("link")
    || normalized.includes("response")
    || normalized.includes("redirect")
  ) return "Links";
  if (normalized.includes("performance")) return "Performance";
  if (normalized.includes("accessibility")) return "Accessibility";
  if (normalized.includes("security")) return "Security";
  return "Crawlability";
}

function mapFindingSeverity(severity: string): Finding["severity"] {
  const normalized = severity.toLowerCase();
  if (normalized === "critical") return "Critical";
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";
  return "Info";
}
