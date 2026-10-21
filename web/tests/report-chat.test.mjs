import test from "node:test";
import assert from "node:assert/strict";
import { applyEdits, editReferences, revision, valueReference } from "../src/lib/report-chat/patch.ts";

const id = "11111111-1111-4111-8111-111111111111";
const fixture = () => ({ summary: {
  property_context: { name: "Arise Knox Square" },
  keyword_strategy: [{ keyword: "old keyword", source: "seed", volume: 10, cpc: 2, difficulty: 4, competition: 0.2, intent: "local", score: 4, assigned_page: "https://example.com/" }],
  content_recommendations: [{ url: "https://example.com/", keywords: ["old keyword", "keep me"], proposed_title: "Existing title" }],
  alt_text_recommendations: [
    { image_url: "https://example.com/pool.jpg", page_url: "https://example.com/", proposed_alt_text: "Old pool description" },
    { image_url: "https://example.com/gym.jpg", page_url: "https://example.com/", proposed_alt_text: "Keep gym description" },
  ],
}, findings: { [id]: { title: "Missing title", description: "A title is missing", recommendation: "Add a title", category: "metadata", severity: "high", page_url: "https://example.com/", resource_url: "" } } });
const edit = (path, before, value, op = "replace") => ({ path, before: typeof before === "string" ? before : JSON.stringify(before), value: typeof value === "string" ? value : JSON.stringify(value), op });

test("one alt-text edit preserves other report content and updates length", () => {
  const original = fixture();
  const {next, changes} = applyEdits(original, [edit("/summary/alt_text_recommendations/0/proposed_alt_text", "Old pool description", "Pool with lounge chairs")]);
  assert.equal(next.summary.alt_text_recommendations[0].proposed_alt_text, "Pool with lounge chairs");
  assert.equal(next.summary.alt_text_recommendations[0].alt_text_length, 23);
  assert.deepEqual(next.summary.alt_text_recommendations[1], original.summary.alt_text_recommendations[1]);
  assert.deepEqual(next.summary.keyword_strategy, original.summary.keyword_strategy);
  assert.equal(original.summary.alt_text_recommendations[0].proposed_alt_text, "Old pool description");
  assert.equal(changes.length, 1);
});
test("keyword replacement can precisely update strategy and page keywords", () => {
  const {next} = applyEdits(fixture(), [edit("/summary/keyword_strategy/0/keyword", "old keyword", "new keyword"), edit("/summary/content_recommendations/0/keywords/0", "old keyword", "new keyword")]);
  assert.equal(next.summary.keyword_strategy[0].keyword, "new keyword");
  assert.deepEqual(next.summary.content_recommendations[0].keywords, ["new keyword", "keep me"]);
});
test("removal and addition preserve the rest of a collection", () => {
  const original = fixture();
  const row = { image_url: "https://example.com/lobby.jpg", page_url: "https://example.com/", proposed_alt_text: "Lobby" };
  const {next} = applyEdits(original, [edit("/summary/alt_text_recommendations/0", original.summary.alt_text_recommendations[0], null, "remove"), edit("/summary/alt_text_recommendations/-", null, row, "add")]);
  assert.deepEqual(next.summary.alt_text_recommendations.map(x=>x.image_url), ["https://example.com/gym.jpg", "https://example.com/lobby.jpg"]);
});
test("stale original values reject the entire request without mutating the input", () => {
  const original = fixture(); const oldRevision = revision(original);
  assert.throws(() => applyEdits(original, [edit("/summary/property_context/name", "Arise Knox Square", "Changed"), edit("/summary/content_recommendations/0/proposed_title", "Incorrect original", "New")]), /original text did not match/);
  assert.equal(revision(original), oldRevision);
});
test("cannot target another report's findings or control audit state", () => {
  for (const path of ["/findings/22222222-2222-4222-8222-222222222222/title", "/audit_id", "/summary/report_edit", "/summary/status", "/summary/fair_housing_enabled"]) assert.throws(() => applyEdits(fixture(), [edit(path, null, "bad", "add")]));
});
test("blocks prototype injection, malformed shapes, and unsafe URLs", () => {
  for (const item of [edit("/summary/__proto__/polluted", null, "yes", "add"), edit("/summary/alt_text_recommendations/0/page_url", "https://example.com/", "javascript:alert(1)")]) assert.throws(() => applyEdits(fixture(), [item]));
  assert.throws(() => applyEdits(fixture(), [edit("/summary/alt_text_recommendations/-", null, {proposed_alt_text:"Missing identity"}, "add")]));
  assert.throws(() => applyEdits(fixture(), [edit("/summary/keyword_strategy/0/volume", 10, "not a number")]));
});
test("finding removal retains a reversible before value", () => {
  const original = fixture();
  const {next, changes} = applyEdits(original, [edit(`/findings/${id}`, original.findings[id], null, "remove")]);
  assert.equal(Object.keys(next.findings).length, 0);
  assert.deepEqual(changes[0].before, original.findings[id]);
});
test("empty edit lists do not change the report", () => {
  const original = fixture();
  assert.deepEqual(applyEdits(original, []), {next:original, changes:[]});
});
test("content revision is independent of object key order", () => {
  assert.equal(revision({summary:{a:1,b:2},findings:{}}),revision({findings:{},summary:{b:2,a:1}}));
});
test("quotes, JSON-looking text and empty strings are kept literally", () => {
  for (const value of ['"Quoted text"', 'null', '123', '']) {
    const {next} = applyEdits(fixture(), [edit("/summary/content_recommendations/0/proposed_title", "Existing title", value)]);
    assert.equal(next.summary.content_recommendations[0].proposed_title, value);
  }
});

test("retain keeps four of 82 pages exactly, including unchanged fields and long crawl text", () => {
  const original = fixture();
  const paths = ["amenities", "faq", "neighborhood", "floorplans"];
  original.summary.content_recommendations = Array.from({ length: 82 }, (_, index) => ({
    url: `https://www.cartergrapevine.com/${paths[index] ?? `rent-estimate-${index}`}`,
    current_h1: "Existing heading", proposed_h1: "Existing heading",
    current_body_text: 'Long crawl text with "quotes" and\nnewlines. '.repeat(200),
    proposed_title: `Existing recommendation ${index}`, implemented_values: { title: "Preserve evidence" },
  }));
  const before = structuredClone(original);
  const path = "/summary/content_recommendations";
  const urls = original.summary.content_recommendations.slice(0, 4).map((row) => row.url).reverse();
  const { next, changes } = applyEdits(original, [{ op: "retain", path, value: JSON.stringify(urls), before: editReferences(original)[path] }]);
  assert.deepEqual(next.summary.content_recommendations, before.summary.content_recommendations.slice(0, 4));
  assert.deepEqual(changes, [{ path, before: before.summary.content_recommendations, after: next.summary.content_recommendations }]);
  assert.deepEqual({ ...next.summary, content_recommendations: [] }, { ...before.summary, content_recommendations: [] });
  assert.deepEqual(next.findings, before.findings);
  assert.deepEqual(original, before);
});
test("retain refuses missing, duplicate, ambiguous or empty URLs and invalid scopes", () => {
  const original = fixture();
  const path = "/summary/content_recommendations";
  const before = valueReference(original.summary.content_recommendations);
  for (const urls of [[], ["https://missing.example/"], ["https://example.com/", "https://example.com/"], [null]]) {
    assert.throws(() => applyEdits(original, [{ op: "retain", path, before, value: JSON.stringify(urls) }]));
  }
  assert.throws(() => applyEdits(original, [{ op: "retain", path: "/summary/keyword_strategy", before, value: '["https://example.com/"]' }]));
  const duplicate = fixture();
  duplicate.summary.content_recommendations.push(structuredClone(duplicate.summary.content_recommendations[0]));
  assert.throws(() => applyEdits(duplicate, [{ op: "retain", path, before: valueReference(duplicate.summary.content_recommendations), value: '["https://example.com/"]' }]), /exactly one/);
});
test("references allow precise object removal but reject stale and wrong-path values atomically", () => {
  const original = fixture();
  const path = "/summary/content_recommendations/0";
  const before = editReferences(original)[path];
  const removal = { op: "remove", path, before, value: "null" };
  assert.deepEqual(applyEdits(original, [removal]).next.summary.content_recommendations, []);
  const changed = fixture();
  changed.summary.content_recommendations[0].proposed_title = "A newer recommendation";
  const snapshot = structuredClone(changed);
  assert.throws(() => applyEdits(changed, [edit("/summary/property_context/name", "Arise Knox Square", "Changed"), removal]), /original text did not match/);
  assert.deepEqual(changed, snapshot);
  assert.throws(() => applyEdits(original, [{ ...removal, path: "/summary/alt_text_recommendations/0" }]), /original text did not match/);
});
test("retain is a no-op when the requested pages are already the complete set", () => {
  const original = fixture();
  const { next, changes } = applyEdits(original, [{ op: "retain", path: "/summary/content_recommendations", value: '["https://example.com/"]', before: valueReference(original.summary.content_recommendations) }]);
  assert.deepEqual(next, original);
  assert.deepEqual(changes, []);
});
test("a hash-looking text field is still compared literally", () => {
  const original = fixture();
  const text = valueReference(original.summary.content_recommendations);
  original.summary.content_recommendations[0].proposed_title = text;
  assert.equal(applyEdits(original, [edit("/summary/content_recommendations/0/proposed_title", text, "New title")]).next.summary.content_recommendations[0].proposed_title, "New title");
});

test("mixed review saves new technical findings and exact copy together", () => {
  const original = fixture();
  const finding = { title: "Schema errors", description: "Analyst reports equal event start/end times and an empty award array.", recommendation: "Verify event times before correcting schema.", category: "technical", severity: "medium", page_url: "https://example.com/", resource_url: "" };
  const newId = "22222222-2222-4222-8222-222222222222";
  const { next, changes } = applyEdits(original, [
    edit("/summary/content_recommendations/0/proposed_title", "Existing title", "Request Information | Cresswind at Hammock Oaks"),
    edit(`/findings/${newId}`, null, finding, "add"),
  ]);
  assert.deepEqual(next.findings[newId], finding);
  assert.equal(changes.length, 2);
  assert.equal(changes[1].before, null);
  assert.equal(Object.keys(original.findings).length, 1);
});
test("new findings reject incomplete rows, extra control fields, unsafe links and existing IDs", () => {
  const original = fixture();
  const newId = "22222222-2222-4222-8222-222222222222";
  for (const finding of [{ title: "Incomplete" }, { ...original.findings[id], audit_id: newId }, { ...original.findings[id], page_url: "javascript:alert(1)" }, { ...original.findings[id], severity: "urgent" }]) {
    assert.throws(() => applyEdits(original, [edit(`/findings/${newId}`, null, finding, "add")]));
  }
  assert.throws(() => applyEdits(original, [edit(`/findings/${id}`, original.findings[id], original.findings[id], "add")]));
});
test("bulk edits support more than 100 changes atomically", () => {
  const original = fixture();
  original.summary.content_recommendations = Array.from({length: 150}, (_, i) => ({url: `https://example.com/${i}`, proposed_h1: `Home ${i} - Model`}));
  const edits = original.summary.content_recommendations.map((row, i) => edit(`/summary/content_recommendations/${i}/proposed_h1`, row.proposed_h1, `Home ${i} | Model`));
  assert.equal(applyEdits(original, edits).changes.length, 150);
  edits[149].before = "Stale";
  assert.throws(() => applyEdits(original, edits), /original text/);
  assert.equal(original.summary.content_recommendations[0].proposed_h1, "Home 0 - Model");
});
test("large pasted reviews are preserved and over-limit reviews fail without truncation", async () => {
  const { reviewMessage, MAX_REVIEW_CHARACTERS } = await import("../src/lib/report-chat/input.ts");
  const review = "Technical findings\n".repeat(1000) + "Final account lead instruction";
  assert.equal(reviewMessage(review), review);
  assert.ok(reviewMessage(review, "selected paragraph").includes("Final account lead instruction"));
  assert.throws(() => reviewMessage("x".repeat(MAX_REVIEW_CHARACTERS + 1)), /Nothing was sent or truncated/);
});
