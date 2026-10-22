import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { findingKind, groupFindings } from "../src/lib/finding-groups.ts";
import * as copy from "../src/lib/finding-copy.ts";

const page = "https://example.com/community/";
const finding = (id, changes = {}) => ({ id, title: "Missing H1", ruleKey: "missing_h1", category: "Content", severity: "Medium", status: "open", occurrences: 1, description: "A heading needs review.", recommendation: "Check the heading.", pageUrl: page, ...changes });
const group = rows => groupFindings(rows, new Map(rows.map(row => [row.id, row.status])));

const source = await readFile(new URL("../src/components/finding-instances.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const require = createRequire(import.meta.url);
const components = new Function("exports", "require", `${output}\nreturn exports;`)({}, id => id === "@/lib/finding-copy" ? copy : require(id));

test("Russell’s four issue layouts are classified explicitly", () => {
  for (const title of ["Broken internal links", "Duplicate meta descriptions", "Duplicate titles", "Structured data that contains markup errors", "Long Title", "Low text to HTML ratio", "Redirection 3Xx", "Temporary redirects", "Missing H2", "Multiple H2", "Page crawl depth", "Permanent redirects", "Pages with only one internal link", "Missing H1"]) assert.equal(findingKind(finding(title, { title, ruleKey: "semrush_site_audit_1" })), "page", title);
  for (const title of ["Missing ALT attributes", "Unminified JavaScript and CSS files", "Disallowed external resources"]) assert.equal(findingKind(finding(title, { title })), "file", title);
  for (const title of ["Links with no anchor text", "Resources formatted as page links", "Links with non-descriptive anchor text"]) assert.equal(findingKind(finding(title, { title })), "link", title);
  assert.equal(findingKind(finding("note", { ruleKey: "analyst_provided" })), "note");
});

test("simple errors show each page once, without markup identifiers masquerading as URLs", () => {
  const rows = [finding("one", { title: "Structured data that contains markup errors", resourceUrl: "J:15:/@graph/3/mainEntity:1565331124" }), finding("two", { title: "Structured data that contains markup errors", resourceUrl: "J:16:/@graph/4" })];
  const [issue] = group(rows);
  assert.equal(issue.occurrences, 1);
  assert.deepEqual(issue.instances[0].findingIds, ["one", "two"]);
  const html = renderToStaticMarkup(components.FindingInstances({ group: issue, updatingKeys: new Set(), onToggle() {} }));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 1);
  assert.ok(html.includes(page));
  assert.ok(!html.includes("@graph"));
  assert.ok(html.includes("Pages with this issue:"));
});

test("file issues show the file once and keep every source finding attached to its checkbox", () => {
  const file = "https://cdn.example.com/photo.jpg";
  const [issue] = group([finding("a", { title: "Missing ALT attributes", resourceUrl: file }), finding("b", { title: "Missing ALT attributes", pageUrl: "https://example.com/other/", resourceUrl: file })]);
  assert.equal(issue.occurrences, 1);
  assert.equal(issue.instances[0].url, file);
  assert.deepEqual(issue.instances[0].findingIds, ["a", "b"]);
  const html = renderToStaticMarkup(components.FindingInstances({ group: issue, updatingKeys: new Set(), onToggle() {} }));
  assert.ok(html.includes(file));
  assert.ok(!html.includes('href="https://example.com/other/"'));
});

test("the same destination on two source pages remains two independently checkable instances", () => {
  const [issue] = group([finding("a", { title: "Links with no anchor text", resourceUrl: "/target/" }), finding("b", { title: "Links with no anchor text", pageUrl: "https://example.com/other/", resourceUrl: "https://example.com/target/" })]);
  assert.equal(issue.occurrences, 2);
  assert.equal(issue.instances[0].url, "https://example.com/target/");
  assert.deepEqual(issue.instances.map(instance => instance.findingIds), [["a"], ["b"]]);
  const html = renderToStaticMarkup(components.FindingInstances({ group: issue, updatingKeys: new Set(), onToggle() {} }));
  assert.equal((html.match(/On page:/g) ?? []).length, 2);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
});

test("unknown destinations remain explicit and unsafe URLs are never rendered as links", () => {
  const [issue] = group([finding("a", { title: "Links with no anchor text", resourceUrl: "javascript:alert(1)" })]);
  const html = renderToStaticMarkup(components.FindingInstances({ group: issue, updatingKeys: new Set(), onToggle() {} }));
  assert.ok(html.includes("Destination URL not recorded"));
  assert.ok(!html.includes("javascript:"));
});

test("an analyst note is one paragraph and one checkbox even with repeated source rows", () => {
  const rows = [finding("a", { ruleKey: "analyst_provided", category: "Account lead", recommendation: "Document only; do not implement." }), finding("b", { ruleKey: "analyst_provided", category: "Account lead", recommendation: "Document only; do not implement." })];
  const notes = group(rows);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].occurrences, 1);
  const html = renderToStaticMarkup(components.AnalystReviewNotes({ groups: notes, updatingKeys: new Set(), onToggle() {} }));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 1);
  assert.ok(html.includes("Analyst review notes"));
  assert.ok(html.includes("do not implement"));
  assert.ok(!html.includes("View affected"));
  assert.deepEqual(notes[0].instances[0].findingIds, ["a", "b"]);
});

test("checking progress requires all retained source findings to be resolved", () => {
  const rows = [finding("a", { status: "resolved" }), finding("b", { status: "open" })];
  assert.equal(group(rows)[0].resolvedCount, 0);
  rows[1].status = "resolved";
  assert.equal(group(rows)[0].resolvedCount, 1);
});

test("checkbox handlers keep page/link pairs independent and group every source row for a file", () => {
  function inputs(node) {
    if (Array.isArray(node)) return node.flatMap(inputs);
    if (!node || typeof node !== "object") return [];
    return node.type === "input" ? [node.props] : inputs(node.props?.children);
  }
  const [links] = group([finding("a", { title: "Links with no anchor text", resourceUrl: "image.jpg" }), finding("b", { title: "Links with no anchor text", pageUrl: "https://example.com/other/", resourceUrl: "/community/image.jpg" })]);
  const toggled = [];
  const checkboxes = inputs(components.FindingInstances({ group: links, updatingKeys: new Set(), onToggle: instance => toggled.push(instance.findingIds) }));
  checkboxes[0].onChange();
  assert.deepEqual(toggled, [["a"]]);
  assert.equal(links.instances[0].url, "https://example.com/community/image.jpg");
  const [files] = group([finding("c", { title: "Missing ALT attributes", resourceUrl: "/image.jpg" }), finding("d", { title: "Missing ALT attributes", resourceUrl: "/image.jpg" })]);
  inputs(components.FindingInstances({ group: files, updatingKeys: new Set(), onToggle: instance => toggled.push(instance.findingIds) }))[0].onChange();
  assert.deepEqual(toggled[1], ["c", "d"]);
});
