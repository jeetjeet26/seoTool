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
    const result = await provider[method]("some-id");
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
