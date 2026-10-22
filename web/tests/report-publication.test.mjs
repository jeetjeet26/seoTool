import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const route = (await readFile(new URL("../src/app/api/audits/[auditId]/publish/route.ts", import.meta.url), "utf8"))
  .replace(/import .* from "next\/server";/, "")
  .replace(/import .* from "@\/lib\/config";/, "")
  .replace(/import .* from "@\/lib\/share\/server";/, "")
  .replace(/import .* from "@\/lib\/supabase\/server";/, "");
const compiled = ts.transpileModule(route, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const makeRoute = new Function("exports", "require", "NextResponse", "isShareBackendConfigured", "isSupabaseConfigured", "publishReport", "createSupabaseServerClient", `${compiled}\nreturn exports.POST;`);

function fixture({ user = "admin-id", publication, configured = true } = {}) {
  let calls = 0;
  const handler = makeRoute({}, require, { json: (body, options) => Response.json(body, options) }, configured, configured,
    async () => { calls++; return publication; },
    async () => ({ auth: { getClaims: async () => ({ data: { claims: user ? { sub: user } : {} } }) } }));
  return { invoke: () => handler(new Request("https://reports.example.com/api/audits/audit-id/publish", { method: "POST" }), { params: Promise.resolve({ auditId: "audit-id" }) }), calls: () => calls };
}

test("repeated publication returns the saved URL and PIN, not newly generated credentials", async () => {
  const f = fixture({ publication: { credentials: { token: "existing-stable-token", pin: "123456" }, reused: true } });
  const first = await f.invoke();
  const second = await f.invoke();
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  assert.equal(f.calls(), 2);
});

test("legacy publications retain existing links even when their plaintext credentials are unavailable", async () => {
  const f = fixture({ publication: { credentials: null, reused: true } });
  const response = await f.invoke();
  assert.deepEqual(await response.json(), { published: true, reused: true, shareUrl: null, pin: null });
});

test("anonymous and unconfigured requests never call the publisher", async () => {
  const anonymous = fixture({ user: null });
  assert.equal((await anonymous.invoke()).status, 401);
  assert.equal(anonymous.calls(), 0);
  const disabled = fixture({ configured: false });
  assert.equal((await disabled.invoke()).status, 503);
  assert.equal(disabled.calls(), 0);
});

test("an open client report reloads changed content without publishing or changing URL", async () => {
  const source = await readFile(new URL("../src/components/share-unlock.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const old = { auditId: "audit-id", reportVersion: "v1", clientName: "Test", reportName: "Test", summary: { executive_summary: "Before" }, findings: [], tasks: [], completedTasks: 0, totalTasks: 0 };
  const fresh = { ...old, reportVersion: "v2", summary: { executive_summary: "After" } };
  const effects = [];
  const calls = [];
  let state = old;
  let stateIndex = 0;
  let nextRefresh;
  const react = {
    useState(initial) {
      const index = stateIndex++;
      return [index === 0 ? state : initial, value => { if (index === 0) state = typeof value === "function" ? value(state) : value; }];
    },
    useRef: () => ({ current: state }),
    useEffect: callback => effects.push(callback),
  };
  const scopedRequire = id => id === "react" ? react : id === "react/jsx-runtime" ? require(id) : {};
  const render = new Function("exports", "require", "fetch", "document", "setTimeout", "clearTimeout", `${output}\nreturn exports.ShareUnlock;`)(
    {}, scopedRequire,
    async path => {
      calls.push(path);
      return Response.json(path.endsWith("/progress")
        ? { progress: { reportVersion: "v2", findings: [], tasks: [], completedTasks: 0, totalTasks: 0 } }
        : { portal: calls.length === 1 ? old : fresh });
    },
    { visibilityState: "visible" }, callback => { nextRefresh = callback; return 1; }, () => {},
  );
  render({ token: "same-token" });
  effects[0]();
  const cleanup = effects[1]();
  for (let i = 0; i < 10 && !nextRefresh; i++) await new Promise(resolve => setImmediate(resolve));
  await nextRefresh();
  assert.deepEqual(calls, ["/api/share/same-token", "/api/share/same-token/progress", "/api/share/same-token"]);
  assert.equal(state.summary.executive_summary, "After");
  assert.equal(state.reportVersion, "v2");
  cleanup();
});
