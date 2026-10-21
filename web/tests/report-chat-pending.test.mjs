import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

test("pending work survives save, reload, and follow-up context without changing report data", async () => {
  const auditId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";
  const pending = ["Semrush measurements need verified source data."];
  const research = [{ tool: "semrush", subject: "new homes", status: "no_data", checkedAt: "2026-10-21T00:00:00Z", data: { volume: null } }];
  const events = [{ id: "legacy", message: "An earlier answer", created_at: new Date(), payload: { requestId: "legacy", prompt: "Earlier question", changes: [] } }];
  const audit = { id: auditId, name: "Test report", target_url: "https://example.com/", status: "completed", summary: {} };
  const queries = [];
  const histories = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    queries.push(query);
    if (query.includes("from public.profiles")) return [{ id: userId }];
    if (query.includes("select count(*)")) return [{ count: 1 }];
    if (query.includes("from public.audits")) return [structuredClone(audit)];
    if (query.includes("from public.findings")) return [];
    if (query.includes("insert into public.audit_events")) {
      const row = { id: values[0], message: values[2], payload: values[3], created_at: new Date() };
      events.push(row);
      return [row];
    }
    if (query.includes("payload->>'requestId'")) return events.filter(row => row.payload.requestId === values[1]);
    if (query.includes("from public.audit_events")) return [...events].reverse();
    throw new Error(`Unexpected query: ${query}`);
  };
  sql.json = value => value;
  sql.begin = callback => callback(sql);
  const planner = async (_document, _target, history) => {
    histories.push(history);
    return { message: "The measurements are still pending.", edits: [], pending, research };
  };
  // Inject dependencies into an isolated module; exercise real sendChat/chatState.
  let source = await readFile(new URL("../src/lib/report-chat/server.ts", import.meta.url), "utf8");
  source = source.replace('import "server-only";', "")
    .replace('import postgres from "postgres";', "")
    .replace(/import .* from "@\/lib\/auth\/user";/, "")
    .replace(/import .* from "@\/lib\/supabase\/server";/, "")
    .replace(/import .* from "\.\/model";/, "")
    .replace('"./patch"', JSON.stringify(new URL("../src/lib/report-chat/patch.ts", import.meta.url).href))
    .replace("function database() {", "function database() { return injectedSql; } function unusedDatabase() {");
  source += "\nexport function inject(sql, planner) { injectedSql = sql; planEdits = planner; }\nlet injectedSql; let planEdits; const REPORT_MODEL = 'test';";
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const server = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
  server.inject(sql, planner);
  const saved = await server.sendChat(auditId, userId, "Pull keyword metrics", "request-1");
  assert.deepEqual(saved.pending, pending);
  assert.deepEqual(saved.research, research);
  assert.deepEqual(saved.changes, []);
  const reloaded = await server.chatState(auditId, userId);
  assert.deepEqual(reloaded.entries.at(-1).pending, pending);
  assert.deepEqual(reloaded.entries[0].pending, []);
  assert.deepEqual(reloaded.entries[0].research, []);
  assert.deepEqual(reloaded.entries.at(-1).research, research);
  const duplicate = await server.sendChat(auditId, userId, "Pull keyword metrics", "request-1");
  assert.equal(duplicate.id, saved.id);
  assert.equal(events.length, 2);
  await server.sendChat(auditId, userId, "What is still pending?", "request-2");
  assert.match(histories.at(-1).at(-1).content, /Pending: Semrush measurements/);
  assert.match(histories.at(-1).at(-1).content, /Previous research.*no_data/);
  assert.ok(queries.every(query => !/update public\.(audits|findings)/.test(query)));
});
