import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

let source = (await readFile(new URL("../src/lib/report-chat/research.ts", import.meta.url), "utf8"))
  .replace('import "server-only";', "")
  .replace(/import .* from "\.\/semrush";/, "let lookupSemrushKeywords;")
  .replace(/import .* from "\.\/live-page";/, "let readLivePage;");
source += "\nexport function inject(keyword, page) { lookupSemrushKeywords = keyword; readLivePage = page; }";
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { createResearchSession, inject } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const target = "https://example.com/community/";
const document = { summary: { content_recommendations: [{ url: target + "ana/" }], competitor_communities: [{ url: "https://builder.example/community/" }] }, findings: {} };
const signal = () => AbortSignal.timeout(3000);

test("nine keyword results and live facts remain read-only, cached, and sourced", async () => {
  const keywordCalls = [], pageCalls = [];
  inject(async keywords => {
    keywordCalls.push(keywords);
    return { results: keywords.map((keyword, index) => ({ keyword, status: index ? "measured" : "no_data", volume: index ? 0 : null })) };
  }, async (url, scope) => { pageCalls.push({ url, scope }); return { status: "ok", url, body_text: "Living Area: 1,434 sq ft; Total: 2,038 sq ft" }; });
  const original = structuredClone(document);
  const session = createResearchSession(document, target, "Verify https://other.example/plan/ then update the recommendation", signal());
  const keywords = Array.from({ length: 9 }, (_, i) => `new homes ${i}`);
  const [metrics, pages] = await Promise.all([
    session.execute("lookup_semrush_keywords", JSON.stringify({ keywords })),
    session.execute("read_live_pages", JSON.stringify({ urls: [target + "ana/"] })),
  ]);
  assert.equal(metrics.results.length, 9);
  assert.equal(metrics.results[0].volume, null);
  assert.equal(metrics.results[1].volume, 0);
  assert.match(pages.pages[0].body_text, /Living Area: 1,434/);
  await session.execute("lookup_semrush_keywords", JSON.stringify({ keywords: [keywords[0], keywords[1].toUpperCase()] }));
  await session.execute("read_live_pages", JSON.stringify({ urls: [target + "ana/"] }));
  assert.equal(keywordCalls.length, 1);
  assert.equal(pageCalls.length, 1);
  assert.deepEqual(pageCalls[0].scope.explicitUserUrls, ["https://other.example/plan/"]);
  assert.ok(pageCalls[0].scope.allowedUrls.includes("https://builder.example/community/"));
  assert.equal(session.sources.length, 10);
  assert.deepEqual(document, original);
});

test("invalid requests and research limits return recoverable output without network calls", async () => {
  let calls = 0;
  inject(async keywords => { calls++; return { results: keywords.map(keyword => ({ keyword, status: "no_data" })) }; }, async url => { calls++; return { status: "error", url }; });
  const session = createResearchSession(document, target, "Research", signal());
  for (const invalid of ["{", "null", '{"keywords":[]}', '{"keywords":[42]}']) assert.equal((await session.execute("lookup_semrush_keywords", invalid)).status, "unavailable");
  assert.equal(calls, 0);
  for (let i = 0; i < 3; i++) await session.execute("lookup_semrush_keywords", JSON.stringify({ keywords: Array.from({ length: 10 }, (_, j) => `keyword ${i}-${j}`) }));
  assert.match((await session.execute("lookup_semrush_keywords", '{"keywords":["31st keyword"]}')).message, /30-keyword/);
  assert.equal(calls, 3);
  for (let i = 0; i < 2; i++) await session.execute("read_live_pages", JSON.stringify({ urls: Array.from({ length: 4 }, (_, j) => target + `${i}-${j}`) }));
  assert.match((await session.execute("read_live_pages", JSON.stringify({ urls: [target + "ninth"] }))).message, /8-page/);
  assert.equal(calls, 11);
});

test("an expired research deadline still lets the caller finish a partial edit", async () => {
  inject(() => { throw new Error("must not request"); }, () => { throw new Error("must not request"); });
  const session = createResearchSession(document, target, "Research", AbortSignal.abort());
  assert.match((await session.execute("lookup_semrush_keywords", '{"keywords":["homes"]}')).message, /time limit/);
  assert.deepEqual(session.sources, []);
});

test("keyword whitespace aliases cannot shift another keyword's measurements", async () => {
  inject(async keywords => ({ results: [...keywords].reverse().map(keyword => ({ keyword, status: "measured", volume: keyword === "new homes" ? 20 : 90 })) }), async () => ({}));
  const session = createResearchSession(document, target, "Research", signal());
  const result = await session.execute("lookup_semrush_keywords", JSON.stringify({ keywords: ["new  homes", "New Homes", "other"] }));
  assert.deepEqual(result.results.map(row => [row.keyword, row.volume]), [["new homes", 20], ["other", 90]]);
});

test("unexpected provider exceptions are recoverable and never expose request secrets", async () => {
  inject(async () => { throw new Error("URL contained secret-key"); }, async () => { throw new Error("private network details"); });
  const session = createResearchSession(document, target, "Research", signal());
  const results = await Promise.all([session.execute("lookup_semrush_keywords", '{"keywords":["homes"]}'), session.execute("read_live_pages", JSON.stringify({ urls: [target] }))]);
  assert.equal(session.sources.length, 2);
  assert.doesNotMatch(JSON.stringify(results), /secret-key|private network/);
  assert.ok(session.sources.every(source => source.status === "error"));
});
