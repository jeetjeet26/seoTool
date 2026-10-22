import test from "node:test";
import assert from "node:assert/strict";
import { conciseFindingCopy } from "../src/lib/finding-copy.ts";

const anchor = {
  title: "Reported links without anchor text", ruleKey: "analyst_provided",
  description: "Analyst-provided review reports two to six links without discernible anchor text per community page. The current Lighthouse samples also identify unnamed links on sampled pages, but the reported page-wide range was not independently verified in this report.",
  recommendation: "Inspect rendered links across the shared template. Add visible or programmatic accessible names that accurately describe each link destination, then re-run accessibility testing.",
};

test("the reported anchor-text count remains qualified in the concise copy", () => {
  const copy = conciseFindingCopy(anchor);
  assert.ok(copy.issue.includes("counts need verification"));
  assert.ok(copy.nextStep.includes("accessible labels"));
  assert.equal(copy.needsVerification, true);
  assert.ok(copy.issue.length + copy.nextStep.length < 180);
});

test("generated crawl dumps become a short problem and action", () => {
  const copy = conciseFindingCopy({ title: "Noindex", ruleKey: "noindex",
    description: "Observed: status code: 200; indexability: Non-Indexable\nWhy it matters: The crawl recorded a noindex directive. This is a problem only if the page is intended to appear in search.\nScope: One URL recorded.",
    recommendation: "Owner: SEO\nImplementation: Confirm search intent with the page owner. Remove noindex if indexing is intended.\nValidation: Re-fetch the HTML and headers.",
  });
  assert.ok(copy.issue.includes("noindex"));
  assert.ok(copy.nextStep.includes("only if"));
  assert.ok(!copy.issue.includes("status code"));
});

test("short analyst wording is preserved instead of replaced by a generic playbook", () => {
  const copy = conciseFindingCopy({ title: "Missing H1", ruleKey: "missing_h1", description: "The heading uses an H2.", recommendation: "Ask the template owner to review the heading." });
  assert.equal(copy.issue, "The heading uses an H2.");
  assert.equal(copy.nextStep, "Ask the template owner to review the heading.");
});

test("document-only instructions remain visible", () => {
  const copy = conciseFindingCopy({ title: "Client review", description: "Source measurements conflict. More investigation is needed.", recommendation: "Document only — account lead review; do not implement. Ask the client to confirm." });
  assert.equal(copy.reviewOnly, true);
  assert.ok(copy.nextStep.includes("do not implement"));
});

test("generated analyst-note wrappers are shortened without losing quoted examples or qualification", () => {
  const copy = conciseFindingCopy({
    title: "Analyst review: Page title", ruleKey: "analyst_feedback_abc123",
    description: 'The supplied Woodland Preserve SEO review dated October 2026 reports: Rewrite, e.g. "Home Features | Woodland Preserve, Parrish FL" This is analyst-provided feedback; counts, crawl states, and technical defects require confirmation against the fresh community-scoped crawl or matching Semrush snapshot.',
    recommendation: "Review the scoped source evidence and address the reported issue if it remains present.",
  });
  assert.ok(copy.issue.includes('"Home Features | Woodland Preserve, Parrish FL"'));
  assert.ok(!copy.issue.includes("The supplied"));
  assert.equal(copy.nextStep, "Confirm the issue before making changes.");
  assert.equal(copy.needsVerification, true);
});
