import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the real persistence function with a query recorder. No production data.
let source = await readFile(new URL("../src/lib/report-chat/server.ts", import.meta.url), "utf8");
source = source.replace('import "server-only";', "")
  .replace('import postgres from "postgres";', "")
  .replace(/import .* from "@\/lib\/auth\/user";/, "")
  .replace(/import .* from "@\/lib\/supabase\/server";/, "")
  .replace(/import .* from "\.\/model";/, "")
  .replace('"./patch"', JSON.stringify(new URL("../src/lib/report-chat/patch.ts", import.meta.url).href))
  .replace("async function persist(", "export async function persist(");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { persist } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const id = "22222222-2222-4222-8222-222222222222";
const auditId = "11111111-1111-4111-8111-111111111111";
const finding = { title: "Missing meta", description: "Analyst evidence", recommendation: "Document only", category: "technical", severity: "medium", page_url: "https://example.com/", resource_url: "" };
const empty = { summary: {}, findings: {} };
const added = { summary: { finding_count: 1 }, findings: { [id]: finding } };
function recorder(updateResult = []) {
  const queries = [];
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    queries.push({ text, values });
    return text.includes("returning id") ? updateResult : [];
  };
  sql.json = value => value;
  return { sql, queries };
}
test("new findings are inserted with provenance and trigger export refresh", async () => {
  const {sql, queries} = recorder();
  await persist(sql, auditId, empty, added, "edit-1");
  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /insert into public.findings/);
  assert.equal(queries[0].values[0], id);
  assert.equal(queries[0].values[1], auditId);
  assert.match(queries[0].values[2], /^[a-f0-9]{64}$/);
  assert.equal(queries[0].values.at(-1).report_chat_created, true);
  assert.equal(queries[0].values.at(-2).source, "analyst_provided");
  assert.equal(queries[1].values[0].report_edit.export_state, "pending");
});
test("undoing an addition hides it and undoing removal restores the same row", async () => {
  const removal = recorder();
  await persist(removal.sql, auditId, added, empty, "undo-add", true);
  assert.match(removal.queries[0].text, /report_hidden/);
  assert.deepEqual(removal.queries[0].values, [auditId, id]);
  const restoration = recorder([{id}]);
  await persist(restoration.sql, auditId, empty, added, "undo-remove", true);
  assert.match(restoration.queries[0].text, /update public.findings/);
  assert.match(restoration.queries[0].text, /metadata - 'report_hidden'/);
  assert.deepEqual(restoration.queries[0].values.slice(-2), [auditId, id]);
  assert.ok(restoration.queries.every(q => !q.text.includes("insert into public.findings")));
});
test("a missing original row cannot be silently recreated on undo", async () => {
  const {sql, queries} = recorder();
  await assert.rejects(persist(sql, auditId, empty, added, "undo", true), /removed since this edit/);
  assert.equal(queries.length, 1);
});
