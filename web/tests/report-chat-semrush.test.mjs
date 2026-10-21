import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = (await readFile(new URL("../src/lib/report-chat/semrush.ts", import.meta.url), "utf8")).replace('import "server-only";', "");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { lookupSemrushKeywords, SEMRUSH_MAX_KEYWORDS } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const fakeKey = "test-secret-never-return";
const header = "Keyword;Search Volume;CPC;Competition;Keyword Difficulty Index";
const csv = (keyword, metrics = "50;1.66;0.96;8") => `${header}\n${keyword};${metrics}\n`;
function setup(t, handler) {
  const oldKey = process.env.SEMRUSH_API_KEY;
  process.env.SEMRUSH_API_KEY = fakeKey;
  t.after(() => { if (oldKey === undefined) delete process.env.SEMRUSH_API_KEY; else process.env.SEMRUSH_API_KEY = oldKey; });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: new URL(url), options });
    return handler(new URL(url), options);
  });
  return calls;
}

test("exact US lookup returns metrics and safe provenance with plus signs intact", async t => {
  const keyword = "55+ communities lady lake fl";
  const calls = setup(t, url => new Response(csv(url.searchParams.get("phrase"))));
  const result = await lookupSemrushKeywords([keyword]);
  assert.equal(result.database, "us");
  assert.equal(calls[0].url.origin, "https://api.semrush.com");
  assert.equal(calls[0].url.searchParams.get("phrase"), keyword);
  assert.equal(calls[0].url.searchParams.get("key"), fakeKey);
  assert.equal(calls[0].url.searchParams.get("type"), "phrase_this");
  assert.equal(calls[0].url.searchParams.get("database"), "us");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.cache, "no-store");
  assert.deepEqual(Object.fromEntries(["volume", "difficulty", "cpc", "competition"].map(key => [key, result.results[0][key]])), { volume: 50, difficulty: 8, cpc: 1.66, competition: 0.96 });
  assert.equal(result.results[0].source, "semrush");
  assert.equal(result.results[0].evidence.query, keyword);
  assert.equal(result.results[0].evidence.semrush_report, "phrase_this");
  assert.equal(result.results[0].evidence.database, "us");
  assert.ok(Number.isFinite(Date.parse(result.results[0].evidence.queried_at)));
  assert.ok(!JSON.stringify(result).includes(fakeKey));
});

test("ERROR 50 is unknown while an explicit zero row is measured zero", async t => {
  setup(t, url => new Response(url.searchParams.get("phrase") === "unknown" ? "ERROR 50 :: NOTHING FOUND\r\n" : csv("zero", "0;0;0;0")));
  const { results: [unknown, zero] } = await lookupSemrushKeywords(["unknown", "zero"]);
  assert.equal(unknown.status, "no_data");
  assert.equal(unknown.volume, null);
  assert.equal(unknown.difficulty, null);
  assert.equal(unknown.evidence.api_code, "50");
  assert.match(unknown.evidence.note, /not measured zeros/);
  assert.equal(zero.status, "measured");
  assert.equal(zero.volume, 0);
  assert.equal(zero.evidence.metrics_status, "measured");
});

test("CSV supports escaped quotes, semicolons, reordered headers, BOM and CRLF", async t => {
  setup(t, () => new Response('\uFEFF"CPC";"Keyword Difficulty Index";"Keyword";"Competition";"Search Volume"\r\n"1.25";"9";"homes; \"\"lake\"\"";"0.5";"20"\r\n'));
  const { results: [row] } = await lookupSemrushKeywords(['homes; "lake"']);
  assert.equal(row.status, "measured");
  assert.equal(row.volume, 20);
  assert.equal(row.cpc, 1.25);
  assert.equal(row.difficulty, 9);
});

test("partial metrics keep blanks and invalid values unknown", async t => {
  setup(t, () => new Response(csv("partial", "0;;2;N/A")));
  const { results: [row] } = await lookupSemrushKeywords(["partial"]);
  assert.equal(row.status, "partial");
  assert.equal(row.volume, 0);
  assert.equal(row.cpc, null);
  assert.equal(row.competition, null);
  assert.equal(row.difficulty, null);
  assert.equal(row.evidence.metrics_status, "partial");
  assert.deepEqual(row.evidence.missing_metrics, ["difficulty", "cpc", "competition"]);
});

test("all invalid metrics are unavailable, including non-finite and negative numbers", async t => {
  setup(t, () => new Response(csv("bad", "1.5;Infinity;-0.3;101")));
  const { results: [row] } = await lookupSemrushKeywords(["bad"]);
  assert.equal(row.status, "unavailable");
  assert.equal(row.error.code, "metrics_unavailable");
  assert.equal(row.volume, null);
});

test("unrelated keywords and broken CSV cannot become measurements", async t => {
  const bodies = [csv("other"), 'Keyword;Search Volume\n"broken', `${header}\nmissing;20;1\n`, `${header}\n`, `${header}\n${header}\n`, ""];
  setup(t, url => new Response(bodies[Number(url.searchParams.get("phrase").slice(1))]));
  const { results } = await lookupSemrushKeywords(bodies.map((_, i) => `k${i}`));
  assert.ok(results.every(row => row.status === "error" && row.volume === null));
  assert.equal(results[0].error.code, "keyword_mismatch");
  assert.equal(results[1].error.code, "invalid_response");
});

test("invalid batches make no paid requests", async t => {
  const calls = setup(t, () => { throw new Error("must not fetch"); });
  for (const keywords of [[], [""], ["x\ny"], ["a".repeat(201)], [42], "not-array", Array.from({ length: SEMRUSH_MAX_KEYWORDS + 1 }, (_, i) => `k${i}`)]) {
    const result = await lookupSemrushKeywords(keywords);
    assert.equal(result.error.code, "invalid_keywords");
    assert.deepEqual(result.results, []);
  }
  assert.equal(calls.length, 0);
});

test("duplicate keywords are normalized and fetched once", async t => {
  const calls = setup(t, url => new Response(csv(url.searchParams.get("phrase").toUpperCase())));
  const { results } = await lookupSemrushKeywords([" new   homes ", "NEW HOMES", "new homes"]);
  assert.equal(calls.length, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "measured");
});

test("missing server credentials give structured unavailability without a fetch", async t => {
  const calls = setup(t, () => { throw new Error("must not fetch"); });
  delete process.env.SEMRUSH_API_KEY;
  const result = await lookupSemrushKeywords(["homes"]);
  assert.equal(calls.length, 0);
  assert.equal(result.error.code, "not_configured");
  assert.equal(result.results[0].status, "unavailable");
  assert.equal(result.results[0].volume, null);
});

test("API quota, credential and HTTP failures do not poison successful siblings or leak secrets", async t => {
  setup(t, url => {
    const keyword = url.searchParams.get("phrase");
    if (keyword === "quota") return new Response(`ERROR 132 :: ${fakeKey}`);
    if (keyword === "credentials") return new Response(`ERROR 120 :: ${fakeKey}`);
    if (keyword === "http") return new Response(fakeKey, { status: 429 });
    return new Response(csv(keyword));
  });
  const result = await lookupSemrushKeywords(["quota", "credentials", "http", "good"]);
  assert.equal(result.results[0].error.code, "units_exhausted");
  assert.equal(result.results[1].error.code, "invalid_credentials");
  assert.equal(result.results[2].error.retryable, true);
  assert.equal(result.results[3].volume, 50);
  assert.ok(!JSON.stringify(result).includes(fakeKey));
});

test("network exception URLs and credentials never escape", async t => {
  setup(t, url => { throw new Error(`Network failure for ${url}`); });
  const result = await lookupSemrushKeywords(["homes"]);
  assert.equal(result.results[0].error.code, "request_failed");
  assert.equal(result.results[0].error.retryable, true);
  assert.ok(!JSON.stringify(result).includes(fakeKey));
  assert.ok(!JSON.stringify(result).includes("https://"));
});

test("pre-cancelled requests avoid network calls", async t => {
  const calls = setup(t, () => { throw new Error("must not fetch"); });
  const controller = new AbortController();
  controller.abort(new Error(fakeKey));
  const result = await lookupSemrushKeywords(["homes"], { signal: controller.signal });
  assert.equal(calls.length, 0);
  assert.equal(result.results[0].error.code, "cancelled");
  assert.ok(!JSON.stringify(result).includes(fakeKey));
});

test("shared cancellation interrupts requests and prevents queued network calls", async t => {
  const controller = new AbortController();
  const calls = setup(t, (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error(fakeKey)), { once: true });
    queueMicrotask(() => controller.abort());
  }));
  const result = await lookupSemrushKeywords(["a", "b", "c", "d", "e"], { signal: controller.signal });
  assert.equal(calls.length, 3);
  assert.ok(result.results.every(row => row.error.code === "cancelled"));
  assert.ok(!JSON.stringify(result).includes(fakeKey));
});

test("per-request timeout is surfaced without leaking the abort reason", async t => {
  const timeoutController = new AbortController();
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", milliseconds => milliseconds === 12_000 ? timeoutController.signal : realTimeout(milliseconds));
  setup(t, (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error(fakeKey)), { once: true });
    queueMicrotask(() => timeoutController.abort(new Error(fakeKey)));
  }));
  const result = await lookupSemrushKeywords(["homes"]);
  assert.equal(result.results[0].error.code, "timeout");
  assert.equal(result.results[0].volume, null);
  assert.ok(!JSON.stringify(result).includes(fakeKey));
});

test("response bytes are capped with or without a Content-Length header", async t => {
  setup(t, url => url.searchParams.get("phrase") === "length"
    ? new Response("small body", { headers: { "Content-Length": "1000000" } })
    : new Response("x".repeat(65_537)));
  const { results } = await lookupSemrushKeywords(["length", "stream"]);
  assert.ok(results.every(row => row.error.code === "response_too_large" && row.volume === null));
});

test("ten keyword batches have at most three requests in flight and preserve order", async t => {
  let active = 0, maximum = 0;
  const calls = setup(t, async url => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return new Response(csv(url.searchParams.get("phrase")));
  });
  const keywords = Array.from({ length: 10 }, (_, i) => `keyword ${i}`);
  const { results } = await lookupSemrushKeywords(keywords);
  assert.equal(calls.length, 10);
  assert.equal(maximum, 3);
  assert.deepEqual(results.map(row => row.keyword), keywords);
  assert.ok(results.every(row => row.status === "measured"));
});
