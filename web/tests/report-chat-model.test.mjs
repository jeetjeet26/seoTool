import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { applyEdits, valueReference } from "../src/lib/report-chat/patch.ts";

// Exercise the server planner with mocked HTTP responses, without Next's
// server-only marker or a database connection in the Node test runner.
const source = (await readFile(new URL("../src/lib/report-chat/model.ts", import.meta.url), "utf8"))
  .replace('import "server-only";', "")
  .replace(/import .* from "\.\/research";/, "const researchTools = []; let createResearchSession = () => ({ sources: [], execute: async () => ({}) }); export function injectResearch(factory) { createResearchSession = factory; }")
  .replace('"./patch"', JSON.stringify(new URL("../src/lib/report-chat/patch.ts", import.meta.url).href));
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { planEdits, injectResearch } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const target = { id: "test", name: "The Carter", url: "https://www.cartergrapevine.com/" };
const fixture = () => ({ summary: { content_recommendations: ["amenities", "faq", "neighborhood", "floorplans", "rent-estimate"].map(path => ({
  url: `${target.url}${path}`, proposed_title: "Existing recommendation", current_h1: "Heading", proposed_h1: "Heading",
})) }, findings: {} });
const retainedPlan = document => ({ message: "Kept the four selected pages unchanged.", edits: [{
  op: "retain", path: "/summary/content_recommendations",
  before: valueReference(document.summary.content_recommendations),
  value: JSON.stringify(document.summary.content_recommendations.slice(0, 4).map(row => row.url)),
}] });
const response = plan => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ pending: [], ...plan }) }] }] });
async function mockModel(t, handler) {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(structuredClone(body));
    return Response.json(handler(body, bodies.length));
  });
  return bodies;
}

test("planner supplies snapshot references and accepts a compact retain plan", async t => {
  const document = fixture();
  const bodies = await mockModel(t, () => response(retainedPlan(document)));
  const history = [{ role: "user", content: document.summary.content_recommendations.slice(0, 4).map(row => row.url).join("\n") }];
  const plan = await planEdits(document, target, history, "Retain the 4 with their existing changes.");
  assert.equal(bodies.length, 1);
  const context = JSON.parse(bodies[0].input[0].content.split("\n").slice(1).join("\n"));
  assert.equal(context.before_refs[plan.edits[0].path], plan.edits[0].before);
  assert.deepEqual(applyEdits(document, plan.edits).next.summary.content_recommendations, document.summary.content_recommendations.slice(0, 4));
});
test("malformed original JSON is repaired once before any edit is returned", async t => {
  const document = fixture();
  const original = structuredClone(document);
  const invalid = { message: "Removed rows", edits: [{ op: "remove", path: "/summary/content_recommendations/4", before: "{...original row...}", value: "null" }] };
  const bodies = await mockModel(t, (_body, count) => response(count === 1 ? invalid : retainedPlan(document)));
  const plan = await planEdits(document, target, [], "Keep only the four listed pages with their existing proposed changes.");
  assert.equal(bodies.length, 2);
  assert.match(bodies[1].input.at(-1).content, /validation failed/);
  assert.equal(plan.edits[0].op, "retain");
  assert.deepEqual(document, original);
});
test("invalid repairs stop after one retry without changing the snapshot", async t => {
  const document = fixture();
  const original = structuredClone(document);
  const plan = retainedPlan(document);
  plan.edits[0].before = valueReference([]);
  const bodies = await mockModel(t, () => response(plan));
  await assert.rejects(planEdits(document, target, [], "Keep these pages"), /original text did not match/);
  assert.equal(bodies.length, 2);
  assert.deepEqual(document, original);
});
test("finding searches provide validated references for reversible removal", async t => {
  const document = fixture();
  const id = "11111111-1111-4111-8111-111111111111";
  document.findings[id] = { title: "Multiple H2", description: "Evidence", recommendation: "Review", category: "headings", severity: "low", page_url: target.url, resource_url: "" };
  const bodies = await mockModel(t, (body, count) => {
    if (count === 1) return { status: "completed", output: [{ type: "function_call", call_id: "search-1", name: "search_findings", arguments: JSON.stringify({ query: "Multiple H2", page_url: "", offset: 0 }) }] };
    const result = JSON.parse(body.input.at(-1).output);
    return response({ message: "Removed the finding", edits: [{ op: "remove", path: `/findings/${id}`, before: result.before_refs[`/findings/${id}`], value: "null" }] });
  });
  const plan = await planEdits(document, target, [], "Remove Multiple H2");
  assert.equal(bodies.length, 2);
  assert.deepEqual(applyEdits(document, plan.edits).next.findings, {});
});

test("planner supports supplied review findings and keeps document-only instructions", async t => {
  const document = fixture();
  const bodies = await mockModel(t, body => {
    const context = JSON.parse(body.input[0].content.split("\n").slice(1).join("\n"));
    return response({ message: "Added the account-lead finding. Semrush volume lookup remains pending.", edits: [{ op: "add", path: `/findings/${context.new_finding_ids[0]}`, before: "null", value: JSON.stringify({ title: "Template heading", description: "Analyst reports the main heading is H2 across 16 communities.", recommendation: "Document only — account lead review; do not implement.", category: "account_lead", severity: "medium", page_url: "", resource_url: "" }) }] });
  });
  const prompt = "Apply this review.\n" + "Review evidence\n".repeat(700) + "Document only: template H2. Pull Semrush volumes.";
  const plan = await planEdits(document, target, [], prompt);
  assert.equal(bodies[0].input.at(-1).content, prompt);
  assert.match(bodies[0].instructions, /read-only lookup_semrush_keywords and read_live_pages/);
  assert.match(Object.values(applyEdits(document, plan.edits).next.findings)[0].recommendation, /Document only/);
});

test("the four-change verification request repairs a malformed append atomically", async t => {
  const document = fixture();
  document.summary.executive_summary = "Existing summary.";
  document.summary.content_recommendations[0].rationale = "Existing rationale.";
  document.summary.keyword_strategy = [];
  const original = structuredClone(document);
  const bodies = await mockModel(t, (body, attempt) => {
    const context = JSON.parse(body.input[0].content.split("\n").slice(1).join("\n"));
    const edits = [
      { op: "replace", path: "/summary/executive_summary", before: context.before_refs["/summary/executive_summary"], value: "Existing summary. Deployment verification 20261021: persistence check." },
      { op: "replace", path: "/summary/content_recommendations/0/rationale", before: context.before_refs["/summary/content_recommendations/0/rationale"], value: "Existing rationale. Deployment verification 20261021: rationale check." },
      { op: "add", path: "/summary/keyword_strategy/-", before: attempt === 1 ? "{invalid reference}" : context.before_refs["/summary/keyword_strategy/-"], value: JSON.stringify({ keyword: "cresswind deployment verification 20261021", source: "analyst_provided_metrics_pending", volume: 0, cpc: 0, difficulty: 0, competition: 0, score: 0, position: null, intent: "informational", assigned_page: target.url, evidence: { note: "Unknown metrics; zero placeholders are not measured zeros." } }) },
      { op: "add", path: `/findings/${context.new_finding_ids[0]}`, before: "null", value: JSON.stringify({ title: "Deployment verification 20261021 — temporary analyst note", severity: "info", category: "account_lead", page_url: "", resource_url: "", description: "Analyst-provided verification note to confirm additions persist after reload and reach Excel. This is not an SEO defect.", recommendation: "Document only — account lead review; do not implement. Remove via Undo after verification." }) },
    ];
    return response({ message: "Applied the four temporary changes only.", edits });
  });
  const prompt = "Apply only four changes: append summary and rationale verification sentences, add a pending-metrics keyword, add a document-only finding.\n" + "Reference appendix: no additional edits.\n".repeat(70);
  const plan = await planEdits(document, target, [], prompt);
  assert.equal(bodies.length, 2);
  assert.match(bodies[1].input.at(-1).content, /\/summary\/keyword_strategy\/-/);
  assert.match(bodies[1].input.at(-1).content, new RegExp(valueReference(null)));
  assert.equal(bodies[0].input.at(-1).content, prompt);
  assert.deepEqual(document, original);
  const result = applyEdits(document, plan.edits);
  assert.equal(result.changes.length, 4);
  assert.equal(result.next.summary.keyword_strategy.length, 1);
  assert.equal(Object.keys(result.next.findings).length, 1);
  assert.deepEqual(result.next.summary.content_recommendations.slice(1), original.summary.content_recommendations.slice(1));
});

test("partial edits return explicit pending work separately from the success message", async t => {
  const document = fixture();
  const pending = ["Semrush volume for the added keywords requires verified measurements.", "Homepage intro needs the existing paragraph before it can be edited."];
  const bodies = await mockModel(t, () => response({ ...retainedPlan(document), pending }));
  const plan = await planEdits(document, target, [], "Could you keep these four pages, edit the homepage intro and pull keyword volume?");
  assert.deepEqual(plan.pending, pending);
  assert.ok(bodies[0].text.format.schema.required.includes("pending"));
  const context = JSON.parse(bodies[0].input[0].content.split("\n").slice(1).join("\n"));
  assert.deepEqual(context.content_page_index[0], { path: "/summary/content_recommendations/0", url: document.summary.content_recommendations[0].url });
});

test("planner uses research results for edits and returns source evidence, leaving unresolved checks pending", async t => {
  const document = fixture();
  const original = structuredClone(document);
  const research = [{ tool: "live_page", subject: document.summary.content_recommendations[0].url, status: "ok", checkedAt: "2026-10-21T00:00:00Z", data: { body_text: "Living area 1,434 sq ft" } }];
  const calls = [];
  injectResearch(() => ({ sources: research, execute: async (name, args) => { calls.push({ name, args: JSON.parse(args) }); return name === "read_live_pages" ? { pages: [research[0].data] } : { results: [{ keyword: "new homes", status: "no_data", volume: null }] }; } }));
  t.after(() => injectResearch(() => ({ sources: [], execute: async () => ({}) })));
  const bodies = await mockModel(t, (body, round) => {
    if (round === 1) return { status: "completed", output: [
      { type: "function_call", call_id: "kw", name: "lookup_semrush_keywords", arguments: JSON.stringify({ keywords: ["new homes"] }) },
      { type: "function_call", call_id: "page", name: "read_live_pages", arguments: JSON.stringify({ urls: [document.summary.content_recommendations[0].url] }) },
    ] };
    assert.equal(body.input.filter(item => item.type === "function_call_output").length, 2);
    return response({ message: "Verified the living area and updated the recommendation.", pending: ["Semrush has no data for new homes."], edits: [{ op: "add", path: "/summary/content_recommendations/0/proposed_meta_description", before: "null", value: "Explore 1,434 sq ft of living space." }] });
  });
  const plan = await planEdits(document, target, [], "Check living square footage and update the meta. Pull Semrush volume for new homes.");
  assert.equal(calls.length, 2);
  assert.equal(bodies.length, 2);
  assert.deepEqual(plan.research, research);
  assert.equal(plan.pending.length, 1);
  assert.match(applyEdits(document, plan.edits).next.summary.content_recommendations[0].proposed_meta_description, /1,434/);
  assert.deepEqual(document, original);
});

test("research-only answers retain evidence without saving report edits", async t => {
  const research = [{ tool: "semrush", subject: "new homes", status: "measured", checkedAt: "2026-10-21T00:00:00Z", data: { volume: 0 } }];
  injectResearch(() => ({ sources: research, execute: async () => ({ results: [research[0].data] }) }));
  t.after(() => injectResearch(() => ({ sources: [], execute: async () => ({}) })));
  await mockModel(t, (_body, round) => round === 1 ? { status: "completed", output: [{ type: "function_call", call_id: "q", name: "lookup_semrush_keywords", arguments: '{"keywords":["new homes"]}' }] } : response({ message: "Semrush US reports zero volume.", edits: [] }));
  const plan = await planEdits(fixture(), target, [], "What is the Semrush search volume for new homes? Do not edit the report.");
  assert.deepEqual(plan.edits, []);
  assert.equal(plan.research[0].data.volume, 0);
});

test("a copied multi-section review completes seven read calls instead of asking the user to narrow it", async t => {
  const document = fixture();
  const id = "11111111-1111-4111-8111-111111111111";
  document.findings[id] = { title: "Missing H1", description: "Existing finding", recommendation: "Review the template", category: "headings", severity: "low", page_url: target.url, resource_url: "" };
  const searches = ["structured", "alt text", "anchor", "sitemap", "redirect", "H1"].map((query, index) => ({
    type: "function_call", call_id: `search-${index}`, name: "search_findings", arguments: JSON.stringify({ query, page_url: "", offset: 0 }),
  }));
  const calls = [...searches, { type: "function_call", call_id: "pages", name: "read_live_pages", arguments: JSON.stringify({ urls: [target.url] }) }];
  injectResearch(() => ({ sources: [], execute: async () => ({ pages: [{ status: "ok", body_text: "Existing intro paragraph." }] }) }));
  t.after(() => injectResearch(() => ({ sources: [], execute: async () => ({}) })));
  const prompt = "Have these changes been made? If not make them.\nSEO review: keep the four selected pages.\nCopied conversation: 23 changes · Saved. Undo this edit.\nSEO review: keep the four selected pages.";
  const history = [{ role: "user", content: "Temporary deployment verification: append a test note." }, { role: "assistant", content: "Added the temporary note. [This edit was undone.]" }];
  const bodies = await mockModel(t, (body, round) => {
    if (round === 1) return { status: "completed", output: calls };
    const results = body.input.filter(item => item.type === "function_call_output");
    assert.deepEqual(results.map(item => item.call_id), calls.map(item => item.call_id));
    assert.equal(JSON.parse(results[5].output).findings[id].title, "Missing H1");
    assert.equal(JSON.parse(results[6].output).pages[0].status, "ok");
    return response(retainedPlan(document));
  });
  const original = structuredClone(document);
  const plan = await planEdits(document, target, history, prompt);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].input.at(-1).content, prompt);
  assert.deepEqual(document, original);
  assert.equal(applyEdits(document, plan.edits).next.summary.content_recommendations.length, 4);
});

test("read calls are queued with bounded concurrency and one failure does not discard other results", async t => {
  let active = 0, maximum = 0;
  const calls = Array.from({ length: 11 }, (_, index) => ({ type: "function_call", call_id: `read-${index}`, name: "lookup_semrush_keywords", arguments: JSON.stringify({ keywords: [`keyword ${index}`] }) }));
  injectResearch(() => ({ sources: [], execute: async (_name, args) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    const keyword = JSON.parse(args).keywords[0];
    if (keyword === "keyword 2") throw new Error("Private provider details must not escape");
    return { keyword, status: "measured", volume: 0 };
  } }));
  t.after(() => injectResearch(() => ({ sources: [], execute: async () => ({}) })));
  await mockModel(t, (body, round) => {
    if (round === 1) return { status: "completed", output: calls };
    const outputs = body.input.filter(item => item.type === "function_call_output");
    assert.deepEqual(outputs.map(item => item.call_id), calls.map(item => item.call_id));
    outputs.forEach((item, index) => {
      const result = JSON.parse(item.output);
      assert.equal(result.status, index === 2 ? "error" : "measured");
      if (index !== 2) assert.equal(result.keyword, `keyword ${index}`);
    });
    assert.ok(!JSON.stringify(outputs).includes("Private provider details"));
    return response({ message: "Completed available lookups.", edits: [], pending: ["Keyword 2 lookup failed."] });
  });
  const plan = await planEdits(fixture(), target, [], "Check these keyword measurements.");
  assert.equal(maximum, 4);
  assert.equal(active, 0);
  assert.deepEqual(plan.pending, ["Keyword 2 lookup failed."]);
});

test("lookup budget exhaustion returns every call result and reserves final synthesis", async t => {
  let executed = 0;
  injectResearch(() => ({ sources: [], execute: async () => { executed++; return { status: "no_data" }; } }));
  t.after(() => injectResearch(() => ({ sources: [], execute: async () => ({}) })));
  const calls = Array.from({ length: 70 }, (_, index) => ({ type: "function_call", call_id: `read-${index}`, name: "lookup_semrush_keywords", arguments: '{"keywords":["same cached keyword"]}' }));
  await mockModel(t, (body, round) => {
    if (round === 1) return { status: "completed", output: calls };
    assert.equal(body.tool_choice, "none");
    const outputs = body.input.filter(item => item.type === "function_call_output");
    assert.equal(outputs.length, calls.length);
    assert.equal(outputs.filter(item => JSON.parse(item.output).status === "unavailable").length, 6);
    return response({ message: "Completed supported work.", edits: [], pending: ["Remaining checks exceeded the lookup budget."] });
  });
  const plan = await planEdits(fixture(), target, [], "Review these requested findings.");
  assert.equal(executed, 64);
  assert.equal(plan.pending.length, 1);
});

test("the research deadline stops queued calls and keeps a model round for the final plan", async t => {
  let now = 1_000;
  t.mock.method(Date, "now", () => now);
  let executed = 0;
  injectResearch(() => ({ sources: [], execute: async () => { executed++; now += 120_001; return { status: "ok" }; } }));
  t.after(() => injectResearch(() => ({ sources: [], execute: async () => ({}) })));
  const calls = Array.from({ length: 7 }, (_, index) => ({ type: "function_call", call_id: `page-${index}`, name: "read_live_pages", arguments: JSON.stringify({ urls: [target.url] }) }));
  await mockModel(t, (body, round) => {
    if (round === 1) return { status: "completed", output: calls };
    assert.equal(body.tool_choice, "none");
    const outputs = body.input.filter(item => item.type === "function_call_output");
    assert.equal(outputs.length, 7);
    assert.equal(JSON.parse(outputs[0].output).status, "ok");
    assert.ok(outputs.slice(1).every(item => JSON.parse(item.output).status === "unavailable"));
    return response({ message: "Completed supported work.", edits: [], pending: ["Remaining live checks reached the research deadline."] });
  });
  await planEdits(fixture(), target, [], "Check the listed pages.");
  assert.equal(executed, 1);
});

test("a final synthesis validation error still gets its repair round", async t => {
  const document = fixture();
  const plan = retainedPlan(document);
  const invalid = structuredClone(plan);
  invalid.edits[0].before = valueReference([]);
  const bodies = await mockModel(t, (body, round) => {
    if (round <= 7) return { status: "completed", output: [{ type: "function_call", call_id: `search-${round}`, name: "search_findings", arguments: '{"query":"","page_url":"","offset":0}' }] };
    assert.equal(body.tool_choice, "none");
    return response(round === 8 ? invalid : plan);
  });
  const result = await planEdits(document, target, [], "Review and retain the four selected pages.");
  assert.equal(bodies.length, 9);
  assert.match(bodies[8].input.at(-1).content, /Edit validation failed/);
  assert.equal(applyEdits(document, result.edits).changes.length, 1);
});

test("existing keyword rows retain unresolved measurements after a fresh no-data lookup", async t => {
  const document = fixture();
  const measured = { keyword: "new homes", source: "semrush", volume: 120, cpc: 1, difficulty: 20, competition: 0.5, position: null, score: 0, intent: "commercial", assigned_page: target.url, evidence: { metrics_status: "measured", queried_at: "2026-10-20T00:00:00Z" } };
  const unknown = { ...measured, keyword: "55+ homes nearby", source: "analyst_provided_metrics_pending", volume: 0, cpc: 0, difficulty: 0, competition: 0, evidence: { metrics_status: "no_data", api_code: "50", queried_at: "2026-10-20T00:00:00Z" } };
  document.summary.keyword_strategy = [measured, unknown];
  const original = structuredClone(document);
  const research = [];
  const requested = [];
  injectResearch(() => ({ sources: research, execute: async (_name, args) => {
    requested.push(...JSON.parse(args).keywords);
    const data = { keyword: unknown.keyword, status: "no_data", volume: null, evidence: { metrics_status: "no_data", api_code: "50", queried_at: "2026-10-21T00:00:00Z" } };
    research.push({ tool: "semrush", subject: unknown.keyword, status: "no_data", checkedAt: data.evidence.queried_at, data });
    return { database: "us", results: [data] };
  } }));
  t.after(() => injectResearch(() => ({ sources: [], execute: async () => ({}) })));
  await mockModel(t, (body, round) => {
    if (round === 1) {
      const context = JSON.parse(body.input[0].content.split("\n").slice(1).join("\n"));
      assert.deepEqual(context.report.summary.keyword_strategy, original.summary.keyword_strategy);
      return { status: "completed", output: [{ type: "function_call", call_id: "missing-volume", name: "lookup_semrush_keywords", arguments: JSON.stringify({ keywords: [unknown.keyword] }) }] };
    }
    const lookup = JSON.parse(body.input.at(-1).output);
    assert.equal(lookup.results[0].status, "no_data");
    return response({ message: "The keyword additions are already present. The missing volume was checked again.", edits: [], pending: [`${unknown.keyword}: Semrush US still returned no data for search volume.`] });
  });
  const plan = await planEdits(document, target, [], "Have these changes been made? If not make them. Add new homes and 55+ homes nearby, and pull Semrush volume for both. Client open question: should we add another competitor?");
  assert.deepEqual(requested, [unknown.keyword]);
  assert.deepEqual(document, original);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.pending, [`${unknown.keyword}: Semrush US still returned no data for search volume.`]);
  assert.equal(plan.research[0].data.evidence.queried_at, "2026-10-21T00:00:00Z");
});

test("a broad review cannot silently mark existing pending keyword measurements complete", async t => {
  const document = fixture();
  document.summary.keyword_strategy = [
    { keyword: "unknown homes", source: "analyst_provided_metrics_pending", volume: 0, difficulty: 0, cpc: 0, competition: 0, score: 0, intent: "commercial", assigned_page: target.url, evidence: { metric_status: "no_data" } },
    { keyword: "measured homes", source: "semrush", volume: 0, difficulty: 0, cpc: 0, competition: 0, score: 0, intent: "commercial", assigned_page: target.url, evidence: { metrics_status: "measured" } },
  ];
  const bodies = await mockModel(t, () => response({ message: "Existing keyword rows are present.", edits: [], pending: [] }));
  const plan = await planEdits(document, target, [], "Have these review changes been made? Pull Semrush volume for unknown homes and measured homes.");
  const context = JSON.parse(bodies[0].input[0].content.split("\n").slice(1).join("\n"));
  assert.deepEqual(context.pending_metric_index.map(item => item.keyword), ["unknown homes"]);
  assert.equal(plan.pending.length, 1);
  assert.match(plan.pending[0], /unknown homes.*volume/);
  assert.doesNotMatch(plan.pending[0], /measured homes/);
});

test("resolved, removed, unrelated, and already reported pending metrics are not added again", async t => {
  const row = { keyword: "unknown homes", source: "analyst_provided_metrics_pending", volume: 0, difficulty: 0, cpc: 0, competition: 0, score: 0, intent: "commercial", assigned_page: target.url, evidence: { metric_status: "no_data" } };
  const document = { summary: { keyword_strategy: [row] }, findings: {} };
  let nextPlan = { message: "Done.", edits: [{ op: "remove", path: "/summary/keyword_strategy/0", before: valueReference(row), value: "null" }], pending: [] };
  await mockModel(t, () => response(nextPlan));
  assert.deepEqual((await planEdits(document, target, [], "Remove unknown homes; its Semrush data is unavailable.")).pending, []);
  const measured = { ...row, source: "semrush", evidence: { metrics_status: "measured" } };
  nextPlan = { message: "Updated.", edits: [{ op: "replace", path: "/summary/keyword_strategy/0", before: valueReference(row), value: JSON.stringify(measured) }], pending: [] };
  assert.deepEqual((await planEdits(document, target, [], "Pull Semrush for unknown homes.")).pending, []);
  nextPlan = { message: "Unchanged.", edits: [], pending: [] };
  assert.deepEqual((await planEdits(document, target, [], "Explain the title counts.")).pending, []);
  nextPlan.pending = ["Semrush has no data for unknown homes."];
  assert.deepEqual((await planEdits(document, target, [], "Pull Semrush for unknown homes.")).pending, nextPlan.pending);
});

test("measured volume is complete when only unrequested keyword metrics are missing", async t => {
  const document = fixture();
  document.summary.keyword_strategy = [{ keyword: "partial homes", source: "semrush", volume: 120, difficulty: 0, cpc: 1, competition: 0.2, score: 0, intent: "commercial", assigned_page: target.url, evidence: { metrics_status: "partial", missing_metrics: ["difficulty"] } }];
  await mockModel(t, () => response({ message: "Existing volume is measured.", edits: [], pending: [] }));
  assert.deepEqual((await planEdits(document, target, [], "Pull Semrush volume for partial homes.")).pending, []);
  const plan = await planEdits(document, target, [], "Pull Semrush metrics for partial homes.");
  assert.equal(plan.pending.length, 1);
  assert.match(plan.pending[0], /partial homes.*difficulty/);
  assert.doesNotMatch(plan.pending[0], /volume/);
});
