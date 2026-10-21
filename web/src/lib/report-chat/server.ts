import "server-only";
import postgres from "postgres";
import { createHash, randomUUID } from "node:crypto";
import { getCurrentProfile } from "@/lib/auth/user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ChatError, applyEdits, revision, type ReportDocument, type Json, type Change } from "./patch";
import { planEdits, REPORT_MODEL, type Conversation } from "./model";

let client: ReturnType<typeof postgres> | undefined;
function database() {
  if (!process.env.SUPABASE_DB_URL) throw new ChatError("Report editing needs the server database connection configured.", 503);
  return client ??= postgres(process.env.SUPABASE_DB_URL, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false });
}
type Sql = postgres.Sql | postgres.TransactionSql;
export type ChatEntry = { id: string; requestId: string; prompt: string; message: string; changes: Change[]; createdAt: string; undoable: boolean };
async function authorize(sql: Sql, userId: string) {
  // The existing app grants all internal analysts/admins access to all audits.
  // Recheck the database role before every direct SQL read/write.
  const rows = await sql`select id from public.profiles where id = ${userId}::uuid and is_active = true and role in ('admin', 'analyst')`;
  if (!rows.length) throw new ChatError("You do not have permission to edit reports.", 403);
}
export async function chatUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new ChatError("Sign in to edit this report.", 401);
  const profile = await getCurrentProfile();
  if (!profile || profile.id !== data.user.id) throw new ChatError("You do not have permission to edit reports.", 403);
  return profile.id;
}
async function load(sql: Sql, auditId: string, lock = false) {
  const audits = lock
    ? await sql`select id, name, target_url, status, summary from public.audits where id = ${auditId}::uuid for update`
    : await sql`select id, name, target_url, status, summary from public.audits where id = ${auditId}::uuid`;
  const audit = audits[0];
  if (!audit) throw new ChatError("Report not found.", 404);
  const rows = lock
    ? await sql`select id, title, description, recommendation, category, severity, page_url, resource_url, metadata from public.findings where audit_id = ${auditId}::uuid order by id for update`
    : await sql`select id, title, description, recommendation, category, severity, page_url, resource_url, metadata from public.findings where audit_id = ${auditId}::uuid order by id`;
  const summary = structuredClone(audit.summary) as Record<string, Json>;
  delete summary.report_edit;
  const findings: ReportDocument["findings"] = {};
  for (const row of rows) {
    if (row.metadata?.report_hidden) continue;
    const { id, ...fields } = row;
    delete fields.metadata;
    findings[id] = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ?? ""])) as Record<string, Json>;
  }
  return { audit, document: { summary, findings } as ReportDocument };
}
function entry(row: postgres.Row): ChatEntry {
  return { id: row.id, requestId: row.payload.requestId, prompt: row.payload.prompt, message: row.message ?? "", changes: row.payload.changes ?? [], createdAt: new Date(row.created_at).toISOString(), undoable: !!row.payload.before && !row.payload.undone };
}
async function recent(sql: Sql, auditId: string) {
  return sql`select id, message, (payload - 'before') || jsonb_build_object('before', payload ? 'before') as payload, created_at from public.audit_events where audit_id = ${auditId}::uuid and event_type = 'report_chat' order by created_at desc, id desc limit 30`;
}
export async function chatState(auditId: string, userId: string) {
  const sql = database();
  await authorize(sql, userId);
  const { audit } = await load(sql, auditId);
  return { entries: (await recent(sql, auditId)).reverse().map(entry), configured: !!process.env.OPENAI_API_KEY, model: REPORT_MODEL, exportState: audit.summary.report_edit?.export_state ?? "ready" };
}
function ensureEditable(status: string) {
  if (!["completed", "review", "published"].includes(status)) throw new ChatError("This report must finish generating before it can be edited.", 409);
}
function counts(document: ReportDocument) {
  const severity: Record<string, number> = {}, category: Record<string, number> = {};
  for (const item of Object.values(document.findings)) {
    severity[String(item.severity)] = (severity[String(item.severity)] ?? 0) + 1;
    category[String(item.category)] = (category[String(item.category)] ?? 0) + 1;
  }
  document.summary.finding_count = Object.keys(document.findings).length;
  document.summary.severity_counts = severity;
  document.summary.category_counts = category;
}
async function persist(sql: postgres.TransactionSql, auditId: string, before: ReportDocument, after: ReportDocument, editId: string, restoring = false) {
  // Hide removed findings instead of deleting their evidence and task references.
  for (const id of new Set([...Object.keys(before.findings), ...Object.keys(after.findings)])) {
    const finding = after.findings[id];
    if (!finding) {
      await sql`update public.findings set metadata = metadata || '{"report_hidden":true}'::jsonb where audit_id = ${auditId}::uuid and id = ${id}::uuid`;
    } else if (JSON.stringify(before.findings[id]) !== JSON.stringify(finding)) {
      const updated = !before.findings[id] && !restoring ? [] : await sql`update public.findings set title = ${String(finding.title)}, description = ${String(finding.description)}, recommendation = ${String(finding.recommendation)}, category = ${String(finding.category)}, severity = ${String(finding.severity)}::public.finding_severity, page_url = ${String(finding.page_url)}, resource_url = ${String(finding.resource_url)}, metadata = (metadata - 'report_hidden') || '{"report_chat_edited":true}'::jsonb where audit_id = ${auditId}::uuid and id = ${id}::uuid returning id`;
      if (!updated.length) {
        if (before.findings[id] || restoring) throw new ChatError("A finding was removed since this edit. The report could not be restored.", 409);
        const stableKey = createHash("sha256").update(`analyst:${auditId}:${id}`).digest("hex");
        await sql`insert into public.findings (id, audit_id, stable_key, rule_key, title, description, recommendation, category, severity, page_url, resource_url, source_file, evidence, metadata)
          values (${id}::uuid, ${auditId}::uuid, ${stableKey}, 'analyst_provided', ${String(finding.title)}, ${String(finding.description)}, ${String(finding.recommendation)}, ${String(finding.category)}, ${String(finding.severity)}::public.finding_severity, ${String(finding.page_url)}, ${String(finding.resource_url)}, 'Analyst review', ${sql.json({ source: "analyst_provided", observation: finding.description } as postgres.JSONValue)}, ${sql.json({ report_chat_edited: true, report_chat_created: true, report_edit_id: editId })})`;
      }
    }
  }
  const summary = { ...after.summary, report_edit: { revision: editId, export_state: "pending", export_attempts: 0 } };
  await sql`update public.audits set summary = ${sql.json(summary as postgres.JSONValue)} where id = ${auditId}::uuid`;
}

export async function sendChat(auditId: string, userId: string, prompt: string, requestId: string) {
  const sql = database();
  await authorize(sql, userId);
  const existing = await sql`select id, message, payload, created_at from public.audit_events where audit_id = ${auditId}::uuid and event_type = 'report_chat' and payload->>'requestId' = ${requestId}`;
  if (existing[0]) return entry(existing[0]);
  const [usage] = await sql`select count(*)::integer as count from public.audit_events where actor_id = ${userId}::uuid and event_type = 'report_chat' and created_at > now() - interval '1 minute'`;
  if (usage.count >= 10) throw new ChatError("Please wait a moment before sending another edit.", 429);
  const { audit, document } = await load(sql, auditId);
  ensureEditable(audit.status);
  const historyRows = (await recent(sql, auditId)).reverse();
  const history: Conversation[] = historyRows.flatMap((row) => [
    { role: "user" as const, content: String(row.payload.prompt) },
    { role: "assistant" as const, content: `${row.message}${row.payload.undone ? " [This edit was undone.]" : ""}` },
  ]);
  const plan = await planEdits(document, { id: auditId, name: String((audit.summary.property_context ?? {}).name || audit.name), url: audit.target_url }, history, prompt);
  const { next, changes } = applyEdits(document, plan.edits);
  if (changes.some((change) => change.path.startsWith("/findings/"))) counts(next);
  return sql.begin(async (tx) => {
    await authorize(tx, userId);
    const current = await load(tx, auditId, true);
    const duplicate = await tx`select id, message, payload, created_at from public.audit_events where audit_id = ${auditId}::uuid and event_type = 'report_chat' and payload->>'requestId' = ${requestId}`;
    if (duplicate[0]) return entry(duplicate[0]);
    ensureEditable(current.audit.status);
    if (revision(current.document) !== revision(document)) throw new ChatError("The report changed while I was working. No edits were applied. Please send your request again.", 409);
    const id = randomUUID();
    if (changes.length) await persist(tx, auditId, document, next, id);
    const payload = { requestId, prompt, model: REPORT_MODEL, changes, ...(changes.length ? { before: document, afterRevision: revision(next) } : {}) };
    const rows = await tx`insert into public.audit_events (id, audit_id, event_type, message, payload, actor_id) values (${id}::uuid, ${auditId}::uuid, 'report_chat', ${plan.message}, ${tx.json(payload as postgres.JSONValue)}, ${userId}::uuid) returning id, message, payload, created_at`;
    return entry(rows[0]);
  });
}
export async function undoChat(auditId: string, userId: string, eventId: string) {
  return database().begin(async (sql) => {
    await authorize(sql, userId);
    const current = await load(sql, auditId, true);
    ensureEditable(current.audit.status);
    const rows = await sql`select id, message, payload, created_at from public.audit_events where audit_id = ${auditId}::uuid and id = ${eventId}::uuid and event_type = 'report_chat' for update`;
    const event = rows[0];
    if (!event?.payload.before) throw new ChatError("This message has no edits to undo.", 404);
    if (event.payload.undone) return { undone: true };
    if (revision(current.document) !== event.payload.afterRevision) throw new ChatError("The report has changed since this edit. Undo newer edits first, or describe the specific change you want to reverse.", 409);
    await persist(sql, auditId, current.document, event.payload.before, randomUUID(), true);
    await sql`update public.audit_events set payload = payload || '{"undone":true}'::jsonb where id = ${eventId}::uuid`;
    await sql`insert into public.audit_events (audit_id, event_type, message, payload, actor_id) values (${auditId}::uuid, 'report_chat_undo', 'Undid a report chat edit', ${sql.json({ eventId })}, ${userId}::uuid)`;
    return { undone: true };
  });
}
