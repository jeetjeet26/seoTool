import test from "node:test";
import assert from "node:assert/strict";
import { mergeApprovedTarget, targetKey, targetRole } from "../src/lib/keyword-targets.ts";

const primary = { keyword: "Homes", canonical_url: "https://example.com/", role: "primary" };
const secondary = { keyword: "New homes", canonical_url: primary.canonical_url, role: "secondary" };

test("additional approvals for one page preserve earlier approvals", () => {
  assert.equal(targetRole([], primary.canonical_url), "primary");
  assert.equal(targetRole([primary], "https://example.com#homes"), "secondary");
  const targets = mergeApprovedTarget([primary], secondary);
  assert.deepEqual(targets, [primary, secondary]);
  assert.equal(targetRole(targets, "https://example.com/other"), "primary");
});

test("replacing a primary retains secondary targets", () => {
  const next = { ...primary, keyword: "Florida homes" };
  assert.deepEqual(mergeApprovedTarget([primary, secondary], next), [secondary, next]);
});

test("moving a keyword removes its previous approval without losing unrelated targets", () => {
  const next = { ...secondary, keyword: " NEW   homes ", canonical_url: "https://example.com/new" };
  assert.deepEqual(mergeApprovedTarget([primary, secondary], next), [primary, next]);
});

test("approval matching normalizes keyword spacing and URL serialization", () => {
  assert.equal(targetKey(" NEW   homes ", "https://example.com#homes"),
    targetKey("new homes", "https://example.com/"));
});
