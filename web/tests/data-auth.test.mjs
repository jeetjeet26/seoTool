import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Run the actual data provider with mocked session and query clients.
const source = (await readFile(new URL("../src/lib/data/supabase.ts", import.meta.url), "utf8"))
  .replace('import "server-only";', "")
  .replace(/import .* from "next\/navigation";/, "")
  .replace(/import .* from "@\/lib\/auth\/user";/, "")
  .replace(/import .* from "@\/lib\/supabase\/server";/, "");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const makeProvider = new Function("exports", "getCurrentProfile", "createSupabaseServerClient", "redirect", `${outputText}\nreturn exports.supabaseData;`);

function fixture(profile) {
  const events = [];
  const redirected = new Error("Redirect to sign-in");
  const query = {
    select() { return this; }, order() { return this; }, eq() { return this; },
    or() { return this; }, range() { return this; }, limit() { return this; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
  };
  const provider = makeProvider({}, async () => { events.push("auth"); return profile; }, async () => {
    events.push("client");
    return { from(table) { events.push(table); return query; } };
  }, (path) => { assert.equal(path, "/login"); events.push("redirect"); throw redirected; });
  return { provider, events, redirected };
}

test("every internal data read redirects before accessing tables without a session", async () => {
  const { provider, events, redirected } = fixture(null);
  for (const method of Object.keys(provider)) {
    events.length = 0;
    await assert.rejects(provider[method]("some-id"), (error) => error === redirected, method);
    assert.deepEqual(events, ["auth", "redirect"], method);
  }
});

test("parallel report reads cannot start anonymous queries", async () => {
  const { provider, events, redirected } = fixture(null);
  const results = await Promise.allSettled([provider.getAudit("audit-id"), provider.getFindings("audit-id"), provider.getToolRuns()]);
  assert.ok(results.every(result => result.status === "rejected" && result.reason === redirected));
  assert.equal(events.filter(event => event === "auth").length, 3);
  assert.ok(events.every(event => event === "auth" || event === "redirect"));
});

test("authenticated readers continue querying after the profile check", async () => {
  const { provider, events } = fixture({ id: "analyst-id", role: "analyst" });
  for (const method of Object.keys(provider)) {
    events.length = 0;
    const result = await provider[method](method === "getAudit" ? "00000000-0000-0000-0000-000000000000" : "some-id");
    assert.ok(result === undefined || Array.isArray(result), method);
    assert.deepEqual(events.slice(0, 2), ["auth", "client"], method);
    assert.equal(events.length, 3, method);
  }
});

test("disabled Supabase configuration still selects the empty data provider", async () => {
  const source = (await readFile(new URL("../src/lib/data/index.ts", import.meta.url), "utf8"))
    .replace(/import .* from ".*";/g, "");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const selectProvider = new Function("exports", "isSupabaseConfigured", "emptyData", "supabaseData", `${outputText}\nreturn exports.data;`);
  const empty = {};
  const live = {};
  assert.equal(selectProvider({}, false, empty, live), empty);
  assert.equal(selectProvider({}, true, empty, live), live);
});

function auditFixture(options = {}) {
  return {
    id: "f5d09817-d63d-59ae-8c4e-95f3531ddad7",
    client_id: "client-id",
    target_url: "https://example.com/",
    status: "completed",
    progress: 100,
    page_limit: 30,
    summary: { executive_summary: "Retained report" },
    published_at: "2026-10-20T18:00:00Z",
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-22T00:00:00Z",
    options,
  };
}

function auditProvider(rows) {
  const requestedIds = [];
  const provider = makeProvider({}, async () => ({ id: "analyst-id" }), async () => ({
    from(table) {
      assert.equal(table, "audits");
      let id;
      return {
        select() { return this; }, order() { return this; },
        eq(column, value) { assert.equal(column, "id"); id = value; requestedIds.push(value); return this; },
        maybeSingle() { return Promise.resolve({ data: rows.find(row => row.id === id) ?? null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
    },
  }), () => { throw new Error("Unexpected redirect"); });
  return { provider, requestedIds };
}

test("archiving hides only marked audits from default lists and retains an explicit history view", async () => {
  const archived = auditFixture({ audit_archive: { archived_at: "2026-10-22T18:00:00Z", replacement_audit_id: "0efbaafa-569f-5912-9342-ab892e8d0ae3" } });
  const current = { ...auditFixture(), id: "0efbaafa-569f-5912-9342-ab892e8d0ae3" };
  const { provider } = auditProvider([current, archived]);
  assert.deepEqual((await provider.getAudits()).map(audit => audit.id), [current.id]);
  const history = await provider.getAudits({ includeArchived: true });
  assert.equal(history.length, 2);
  assert.equal(history[1].archive.replacementAuditId, current.id);
  assert.equal(history[1].status, "published");
});

test("archived direct report lookup remains accessible without using the filtered listing", async () => {
  const archived = auditFixture({ audit_archive: { archived_at: "2026-10-22T18:00:00Z" } });
  const { provider, requestedIds } = auditProvider([archived]);
  provider.getAudits = () => { throw new Error("Direct lookup must not depend on the listing"); };
  const report = await provider.getAudit(archived.id);
  assert.equal(report.id, archived.id);
  assert.deepEqual(report.summary, archived.summary);
  assert.deepEqual(requestedIds, [archived.id]);
  assert.equal(await provider.getAudit("00000000-0000-0000-0000-000000000000"), undefined);
});

test("malformed audit IDs still require authentication and never query the audits table", async () => {
  const { provider, events } = fixture({ id: "analyst-id" });
  assert.equal(await provider.getAudit("not-a-uuid"), undefined);
  assert.deepEqual(events, ["auth", "client"]);
  const anonymous = fixture(null);
  await assert.rejects(anonymous.provider.getAudit("not-a-uuid"), error => error === anonymous.redirected);
  assert.deepEqual(anonymous.events, ["auth", "redirect"]);
});

test("removing the archive marker restores an audit without changing report data", async () => {
  const row = auditFixture({ audit_archive: { archived_at: "2026-10-22T18:00:00Z" } });
  const { provider } = auditProvider([row]);
  assert.equal((await provider.getAudits()).length, 0);
  delete row.options.audit_archive;
  const [restored] = await provider.getAudits();
  assert.equal(restored.id, row.id);
  assert.deepEqual(restored.summary, row.summary);
});

test("invalid archive metadata cannot hide a report or create an arbitrary replacement URL", async () => {
  const malformed = auditFixture({ audit_archive: { archived_at: "not a date" } });
  const { provider } = auditProvider([malformed]);
  assert.equal((await provider.getAudits()).length, 1);
  malformed.options.audit_archive = { archived_at: "2026-10-22T18:00:00Z", replacement_audit_id: "../api/delete" };
  const report = await provider.getAudit(malformed.id);
  assert.equal(report.archive.replacementAuditId, undefined);
});
