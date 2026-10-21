import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { applyEdits, valueReference } from "../src/lib/report-chat/patch.ts";

// Exercise the server planner with mocked HTTP responses, without Next's
// server-only marker or a database connection in the Node test runner.
const source = (await readFile(new URL("../src/lib/report-chat/model.ts", import.meta.url), "utf8"))
  .replace('import "server-only";', "")
  .replace('"./patch"', JSON.stringify(new URL("../src/lib/report-chat/patch.ts", import.meta.url).href));
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { planEdits } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const target = { id: "test", name: "The Carter", url: "https://www.cartergrapevine.com/" };
const fixture = () => ({ summary: { content_recommendations: ["amenities", "faq", "neighborhood", "floorplans", "rent-estimate"].map(path => ({
  url: `${target.url}${path}`, proposed_title: "Existing recommendation", current_h1: "Heading", proposed_h1: "Heading",
})) }, findings: {} });
const retainedPlan = document => ({ message: "Kept the four selected pages unchanged.", edits: [{
  op: "retain", path: "/summary/content_recommendations",
  before: valueReference(document.summary.content_recommendations),
  value: JSON.stringify(document.summary.content_recommendations.slice(0, 4).map(row => row.url)),
}] });
const response = plan => ({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(plan) }] }] });
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
  assert.match(bodies[0].instructions, /no live website, Semrush/);
  assert.match(Object.values(applyEdits(document, plan.edits).next.findings)[0].recommendation, /Document only/);
});
