type FindingCopy = { ruleKey?: string; title: string; description?: string; recommendation?: string };

const briefCopy: Record<string, [string, string]> = {
  missing_h1: ["The crawl did not record an H1. Check the rendered page.", "Use a descriptive main H1 and recheck the page."],
  missing_title: ["The crawl did not record a page title.", "Add a descriptive title using the page’s title recommendation."],
  long_title: ["The title needs a length and readability review.", "Remove repeated wording and keep the page topic clear; preview the result."],
  long_meta_description: ["The description needs a length and readability review.", "Use a concise, page-specific description with a clear next step."],
  missing_meta_description: ["The crawl did not record a meta description.", "Add the page-specific description and confirm the tag appears in the HTML."],
  duplicate_meta_description: ["Multiple URLs share a meta description.", "Give distinct indexable pages unique descriptions; review canonical URLs for true duplicates."],
  duplicate_title: ["Multiple URLs share a page title.", "Give distinct indexable pages unique titles; review canonical URLs for true duplicates."],
  missing_canonical: ["The crawl did not record a canonical URL.", "Check for duplicate URLs and set the preferred indexable URL where needed."],
  noindex: ["The page has a noindex directive.", "Remove it only if this page should appear in search."],
  redirection_3xx: ["The URL redirects to another address.", "Verify the destination, then update applicable links to point there directly."],
  lighthouse_unused_javascript: ["Lighthouse flagged unused JavaScript on this sampled page.", "Remove unused code, defer nonessential scripts, and retest forms and analytics."],
  lighthouse_unused_css_rules: ["Lighthouse flagged unused CSS on this sampled page.", "Remove unused styles and retest responsive layouts and interactive states."],
  lighthouse_cache_insight: ["Lighthouse flagged short cache lifetimes on sampled resources.", "Cache versioned assets longer; avoid immutable caching for personalized HTML."],
  lighthouse_image_delivery_insight: ["Lighthouse flagged image delivery on this sampled page.", "Resize and compress images, use responsive formats, and avoid lazy-loading the main visible image."],
  lighthouse_render_blocking_insight: ["Some resources delayed rendering in this Lighthouse sample.", "Defer noncritical scripts and styles, then check for visual or functional issues."],
  lighthouse_font_display_insight: ["Lighthouse flagged font loading on this sampled page.", "Set font-display and suitable fallbacks, then check text visibility and layout shifts."],
  lighthouse_forced_reflow_insight: ["Lighthouse flagged forced layout work on this sampled page.", "Profile the scripts, batch layout reads and writes, and compare the results."],
  lighthouse_lcp_discovery_insight: ["Lighthouse flagged discovery of this page’s main visible resource.", "Make it discoverable in the initial HTML and avoid lazy-loading it; retest loading priority."],
  lighthouse_layout_shifts: ["Lighthouse recorded layout shifts on this sampled page.", "Reserve image and embed space, stabilize fonts, and recheck the same viewport."],
  lighthouse_legacy_javascript_insight: ["Lighthouse flagged legacy JavaScript on this sampled page.", "Review unnecessary polyfills and transforms while preserving support for required browsers."],
};

function section(text: string, label: string) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line.startsWith(`${label}:`));
  if (start === -1) return text;
  const remaining = lines.slice(start);
  const end = remaining.findIndex((line, index) => index > 0 && /^[A-Z][A-Za-z ]+:/.test(line));
  return remaining.slice(0, end === -1 ? undefined : end).join(" ").slice(label.length + 1).trim();
}

function shortSentence(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const first = normalized.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? normalized;
  return shortText(first);
}

function shortText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 210) return normalized;
  return normalized.slice(0, 207).replace(/\s+\S*$/, "") + "…";
}

export function conciseFindingCopy(finding: FindingCopy) {
  const description = finding.description ?? "";
  const recommendation = finding.recommendation ?? "";
  const needsVerification = /not (?:independently )?verified|unverified|not (?:independently )?confirmed|unconfirmed|pending.{0,35}confirmation|require[s]?.{0,35}(?:confirmation|verification)|conflicting|could not.{0,25}verif/i.test(`${description} ${recommendation}`);
  const reviewOnly = /document only|do not implement/i.test(recommendation);
  const analystDetail = /^analyst_feedback_/.test(finding.ruleKey ?? "")
    ? description.match(/^The supplied .+? reports:\s*([\s\S]*?)\s*This is analyst-provided feedback;/)?.[1]
    : undefined;
  if (analystDetail && !reviewOnly) return {
    issue: shortText(analystDetail).replace(/([^.!?…])$/, "$1."),
    nextStep: recommendation === "Review the scoped source evidence and address the reported issue if it remains present."
      ? "Confirm the issue before making changes."
      : shortSentence(recommendation),
    needsVerification, reviewOnly,
  };
  // Only replace generated playbook text. Analyst-written recommendations use
  // their own wording; the full copy remains in the report data.
  const generated = /^Observed:/m.test(description) && /^Scope:/m.test(description)
    && /^Owner:/m.test(recommendation) && /^Implementation:/m.test(recommendation) && /^Validation:/m.test(recommendation);
  const brief = generated && !reviewOnly ? briefCopy[finding.ruleKey ?? ""] : undefined;
  const anchorTextReview = /links without anchor text/i.test(finding.title) && needsVerification;
  return {
    issue: anchorTextReview
      ? "Some links were reported without descriptive text; counts need verification."
      : brief?.[0] ?? shortSentence(section(description, "Why it matters")),
    nextStep: anchorTextReview && !reviewOnly
      ? "Check the links and add text or accessible labels that describe their destination."
      : brief?.[1] ?? shortSentence(section(recommendation, "Implementation")),
    needsVerification,
    reviewOnly,
  };
}

const groupCopy: Array<[RegExp, string, string]> = [
  [/broken internal links?/, "An internal link leads to an unavailable page.", "Check the destination and update or remove the broken link."],
  [/duplicate meta descriptions?/, "Multiple pages share the same meta description.", "Give distinct indexable pages their own descriptions."],
  [/duplicate titles?|duplicate title tag/, "Multiple pages share the same title.", "Give distinct indexable pages their own titles."],
  [/structured data.*(?:markup|errors?)/, "Structured data contains fields that need validation.", "Check the markup against the schema requirements."],
  [/long title/, "The title needs a length and readability review.", "Remove repeated wording and preview the result."],
  [/low text to html ratio/, "The page has little text relative to its HTML.", "Review useful page content and unnecessary markup."],
  [/temporary redirects?/, "The URL uses a temporary redirect.", "Confirm the redirect is intentional and update applicable internal links."],
  [/permanent redirects?/, "The URL uses a permanent redirect.", "Check the destination and update applicable internal links."],
  [/redirection 3xx|3xx redirection/, "The URL redirects to another address.", "Verify the destination and update applicable links."],
  [/missing h2/, "The crawl did not record an H2.", "Add subheadings where they help organize the page."],
  [/multiple h2/, "Multiple H2 headings were reported.", "Review the heading outline; multiple H2s can be intentional."],
  [/page crawl depth/, "The page is deeper in the site’s link structure.", "Review whether it needs a more accessible internal link."],
  [/pages? with only one internal link/, "Only one internal link was reported for this page.", "Review its internal linking."],
  [/missing h1/, "The crawl did not record an H1.", "Check the rendered page and use a descriptive main heading."],
  [/missing alt|alt attributes/, "Image references are missing alt attributes.", "Add descriptive alt text, or empty alt for decorative images."],
  [/unminified/, "These scripts or stylesheets were reported as unminified.", "Check the files, minify where needed, and retest page functionality."],
  [/disallowed external resources/, "An external resource was reported as blocked.", "Verify whether it should be accessible."],
  [/no anchor text|without anchor text/, "Links were reported without anchor text.", "Check their accessible names and add meaningful text where needed."],
  [/resources formatted as page links/, "A page link points to a file or resource.", "Confirm that destination is intended."],
  [/non descriptive anchor/, "Link text does not clearly describe its destination.", "Use a meaningful link label."],
];

export function findingGroupCopy(finding: FindingCopy) {
  const copy = conciseFindingCopy(finding);
  const title = finding.title.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[_-]+/g, " ");
  const brief = groupCopy.find(([pattern]) => pattern.test(title));
  return brief && !copy.reviewOnly ? { ...copy, issue: brief[1], nextStep: brief[2] } : copy;
}
