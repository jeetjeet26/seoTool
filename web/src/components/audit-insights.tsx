import type {
  AltTextRecommendation,
  AuditSummary,
  ContentRecommendation,
  PageExperience,
} from "@/lib/data/types";
import { KeywordStrategyReview } from "@/components/keyword-strategy-review";
import { characterCount } from "@/lib/text-metrics";

type ApprovedTarget = {
  id: string;
  keyword: string;
  canonical_url: string;
  role: "primary" | "secondary";
};

export function AuditInsights({
  auditId,
  summary,
  approvedTargets = [],
}: {
  auditId?: string;
  summary: AuditSummary;
  approvedTargets?: ApprovedTarget[];
}) {
  const propertyName = summary.property_context?.name ?? "";
  const applyPropertyCasing = (value?: string) => restorePropertyCasing(value, propertyName);
  const keywords = (summary.keyword_strategy ?? []).map((item) => ({
    ...item,
    keyword: applyPropertyCasing(item.keyword),
  }));
  const recommendations = (summary.content_recommendations ?? []).map((item) => ({
    ...item,
    current_title: applyPropertyCasing(item.current_title),
    current_h1: applyPropertyCasing(item.current_h1),
    current_meta_description: applyPropertyCasing(item.current_meta_description),
    keywords: item.keywords?.map(applyPropertyCasing),
    proposed_title: applyPropertyCasing(item.proposed_title),
    proposed_h1: applyPropertyCasing(item.proposed_h1),
    proposed_meta_description: applyPropertyCasing(item.proposed_meta_description),
    proposed_content: applyPropertyCasing(item.proposed_content),
    current_body_text: applyPropertyCasing(item.current_body_text),
    rationale: applyPropertyCasing(item.rationale),
  }));
  const altText = (summary.alt_text_recommendations ?? []).map((item) => ({
    ...item,
    current_alt_text: applyPropertyCasing(item.current_alt_text),
    proposed_alt_text: applyPropertyCasing(item.proposed_alt_text),
  }));
  const targets = approvedTargets.map((target) => ({
    ...target,
    keyword: applyPropertyCasing(target.keyword),
  }));
  const pageExperience = summary.page_experience ?? [];
  const errors = summary.enrichment_errors ?? [];
  const pageAnalysisUnavailable =
    summary.crawl_coverage?.mode === "browser_http_fallback"
    && !recommendations.length;

  return <>
    <ServiceStatus errors={errors} />
    <PropertyContext summary={summary} />
    {summary.recommendation_progress?.previous_audit_id && <section className="card report-section">
      <div className="section-title"><div><h2>Previous recommendations</h2><p>Compared with the previous audit, including saved report edits. Matching wording is preserved unless a specific issue remains. Use a fresh crawl or newly generated exports.</p></div></div>
      <p>{summary.recommendation_progress.items.filter(item => item.status === "implemented").length} implemented · {summary.recommendation_progress.items.filter(item => item.status === "not_implemented").length} not matched · {summary.recommendation_progress.items.filter(item => item.status === "not_verified").length} not verified</p>
      <details><summary>View comparison details</summary><div className="table-wrap"><table><thead><tr><th>Page / image</th><th>Field</th><th>Status</th><th>Evidence</th></tr></thead><tbody>{summary.recommendation_progress.items.map((item, index) => <tr key={index}><td><ReportLink url={item.url}/>{item.image_url && <><br/><ReportLink url={item.image_url}/></>}</td><td>{item.field.replaceAll("_", " ")}</td><td>{item.status === "implemented" ? "Implemented" : item.status === "not_verified" ? "Not verified" : "Not matched"}</td><td>{item.reason}</td></tr>)}</tbody></table></div></details>
    </section>}
    <CrawlCoverage summary={summary} />
    <SiteInventory summary={summary} />
    <SemrushSiteAudit summary={summary} />
    <KeywordStrategyReview key={`${auditId ?? "preview"}:${JSON.stringify(targets)}`} auditId={auditId} keywords={keywords} initialTargets={targets} />
    <SearchVisibility summary={summary} />
    {pageAnalysisUnavailable && <PageRecommendationsUnavailable />}
    {recommendations.length > 0 && <RecommendationSection
      title="Title tag recommendations"
      description={`${recommendations.length} crawled pages with current and proposed title tags.`}
      recommendations={recommendations}
      currentKey="current_title"
      proposedKey="proposed_title"
      includeUnchanged
    />}
    {recommendations.length > 0 && <RecommendationSection
      title="Meta description recommendations"
      description={`${recommendations.length} crawled pages with current and proposed descriptions.`}
      recommendations={recommendations}
      currentKey="current_meta_description"
      proposedKey="proposed_meta_description"
    />}
    {recommendations.length > 0 && <RecommendationSection
      title="H1 recommendations"
      description={`${recommendations.length} crawled pages with current and proposed primary headings.`}
      recommendations={recommendations}
      currentKey="current_h1"
      proposedKey="proposed_h1"
      includeUnchanged
    />}
    {recommendations.length > 0 && <OnPageRecommendations recommendations={recommendations} />}
    {altText.length > 0 && <AltTextRecommendations items={altText} />}
    {pageExperience.length > 0 && <PageSpeedResults results={pageExperience} errors={errors} />}
  </>;
}

function PageRecommendationsUnavailable() {
  return <section className="card report-section analysis-notice">
    <div className="section-title"><div><h2>Page-level recommendations unavailable</h2><p>Cloudflare blocked both Screaming Frog and browser-style requests from Render. Semrush supplies the technical findings in this report, but current titles, descriptions, headings, body copy, and image context require a local crawl import.</p></div></div>
  </section>;
}

function CrawlCoverage({ summary }: { summary: AuditSummary }) {
  const coverage = summary.crawl_coverage;
  if (!coverage) return null;
  const fallback = coverage.mode === "browser_http_fallback";
  const imported = coverage.mode === "screaming_frog_import";
  return <section className={`card report-section${fallback ? " analysis-notice" : ""}`}>
    <div className="section-title"><div><h2>Data source coverage</h2><p>{
      fallback
        ? "Screaming Frog was blocked. This report uses browser-style page analysis plus the matching Semrush Site Audit."
        : imported
          ? "This report uses locally generated Screaming Frog exports plus supplemental Semrush evidence."
          : "Screaming Frog completed successfully; Semrush provides supplemental technical and search evidence."
    }</p></div></div>
    <div className="insight-metrics">
      <article><span>Screaming Frog</span><strong>{fallback ? "Blocked" : imported ? "Local import" : "Complete"}</strong></article>
      <article><span>Page analysis</span><strong>{fallback ? "Browser fallback" : imported ? "Uploaded exports" : "Screaming Frog"}</strong></article>
      <article><span>Pages analyzed</span><strong>{formatNumber(coverage.pages)}</strong></article>
      {!!coverage.event_pages && <article><span>Event pages included</span><strong>{formatNumber(coverage.event_pages)}</strong></article>}
      <article><span>Semrush issues</span><strong>{summary.semrush_site_audit?.project_id ? "Included" : "Unavailable"}</strong></article>
    </div>
  </section>;
}

function PropertyContext({ summary }: { summary: AuditSummary }) {
  const property = summary.property_context;
  if (!property) return null;
  const metrics = [
    ["Property", property.name],
    ["Location", property.location],
    ["Metro market", property.secondary_market],
    ["Vertical", property.vertical?.replaceAll("_", " ")],
    ["Address", property.address],
    ["Report", summary.report_variant === "in_house" ? "In-house SEO Treatment" : "Full client"],
  ].filter(([, value]) => value);
  return <section className="card report-section">
    <div className="section-title"><div><h2>Property and report context</h2><p>The approved facts driving keyword and copy decisions.</p></div></div>
    <div className="insight-metrics">{metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
  </section>;
}

function SemrushSiteAudit({ summary }: { summary: AuditSummary }) {
  const audit = summary.semrush_site_audit;
  if (!audit?.project_id) return null;
  const scopeUrl = audit.scope_url || summary.target_url;
  const snapshotDate = audit.snapshot_finished_at ? new Date(audit.snapshot_finished_at) : null;
  const completedDate = snapshotDate && !Number.isNaN(snapshotDate.getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(snapshotDate)
    : "";
  return <section className="card report-section">
    <div className="section-title"><div><h2>Semrush Site Audit</h2><p>{audit.project_name || audit.domain || `Project ${audit.project_id}`} · Completed snapshot{completedDate ? `: ${completedDate}` : ""}.</p>{audit.scope_description && <p>{audit.scope_description}</p>}{scopeUrl && <p>Report scope: <ReportLink url={scopeUrl}/></p>}</div></div>
    <div className="insight-metrics">
      <article><span>{audit.project_scope === "portfolio" ? "Portfolio pages crawled" : "Project pages crawled"}</span><strong>{formatNumber(audit.pages_crawled)}</strong></article>
      {audit.scoped_pages !== undefined && <article><span>Affected pages in report scope</span><strong>{formatNumber(audit.scoped_pages)}</strong></article>}
      <article><span>Errors in report scope</span><strong>{formatNumber(audit.errors)}</strong></article>
      <article><span>Warnings in report scope</span><strong>{formatNumber(audit.warnings)}</strong></article>
      <article><span>Notices in report scope</span><strong>{formatNumber(audit.notices)}</strong></article>
      {audit.issue_types !== undefined && <article><span>Issue types in report scope</span><strong>{formatNumber(audit.issue_types)}</strong></article>}
    </div>
  </section>;
}

function ServiceStatus({
  errors,
}: {
  errors: Array<{ service: string; message: string }>;
}) {
  if (!errors.length) return null;
  return <section className="card report-section analysis-notice">
    <div className="section-title"><div><h2>Analysis coverage</h2><p>External services that did not return complete results.</p></div></div>
    <div className="analysis-errors">
      {errors.map((error, index) => <p key={`${error.service}-${index}`}><strong>{error.service}</strong>{error.message}</p>)}
    </div>
  </section>;
}

function SiteInventory({ summary }: { summary: AuditSummary }) {
  const inventory = summary.site_inventory ?? {};
  const metrics = [
    ["Core HTML pages", inventory.page_count],
    ["All crawled HTML pages", inventory.total_crawled_page_count],
    ["Sitemap URLs", inventory.sitemap_url_count],
    ["Sitemap-only URLs", inventory.sitemap_only_count],
    ["Crawl-only URLs", inventory.crawl_only_count],
  ] as const;
  return <section className="card report-section">
    <div className="section-title"><div><h2>Site inventory</h2><p>Crawl and XML sitemap reconciliation.</p></div></div>
    <div className="insight-metrics inventory-metrics">
      {metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{formatNumber(value)}</strong></article>)}
    </div>
  </section>;
}

function SearchVisibility({ summary }: { summary: AuditSummary }) {
  const semrush = summary.semrush ?? {};
  const communities = summary.competitor_communities ?? [];
  const competitors = summary.competitors ?? [];
  const neighborhoods = summary.nearby_neighborhoods ?? [];
  const backlinks = summary.backlinks ?? {};
  return <section className="card report-section">
    <div className="section-title"><div><h2>Search visibility</h2><p>Semrush organic visibility, backlink authority, and competitors.</p></div></div>
    <div className="insight-metrics">
      {Object.entries(semrush).map(([key, value]) => <article key={key}><span>{humanize(key)}</span><strong>{formatNumber(value)}</strong></article>)}
      {Object.entries(backlinks).map(([key, value]) => <article key={key}><span>{humanize(key)}</span><strong>{formatNumber(value)}</strong></article>)}
    </div>
    <div className="subsection">
      <h3>{communities.length ? "Selected competitor communities" : "Compare domains"}</h3>
      {communities.length
        ? <div className="table-wrap"><table><thead><tr><th>Community</th><th>Builder</th><th>Location</th><th>Distance</th><th>Verification</th><th>Website</th><th>Comparison notes</th></tr></thead><tbody>{communities.map((item) => <tr key={item.place_id || `${item.name}-${item.location}`}><td><strong>{item.name}</strong></td><td>{item.builder || "—"}</td><td>{item.location}</td><td>{item.distance_miles == null ? "—" : `${formatNumber(item.distance_miles)} mi`}{item.distance_note && <p>{item.distance_note}</p>}</td><td>{item.resolution_status === "verified" ? (item.source === "official_builder_website" ? "Builder verified" : "Google verified") : "Provided"}</td><td className="url-cell">{item.url ? <ReportLink url={item.url}/> : "—"}</td><td>{item.comparison_note || item.notes || "—"}</td></tr>)}</tbody></table></div>
        : competitors.length
          ? <div className="table-wrap"><table><thead><tr><th>Domain</th><th>Source</th><th>Relevance</th><th>Shared keywords</th><th>Organic keywords</th><th>Traffic</th></tr></thead><tbody>{competitors.map((item) => <tr key={item.domain}><td><strong>{item.domain}</strong></td><td>{item.source === "provided" ? "Provided" : "Semrush"}</td><td>{item.competition_level}</td><td>{formatNumber(item.common_keywords)}</td><td>{formatNumber(item.organic_keywords)}</td><td>{formatNumber(item.organic_traffic)}</td></tr>)}</tbody></table></div>
          : <EmptyState text="No competitor communities or domains were provided for this audit."/>}
    </div>
    {neighborhoods.length > 0 && <div className="subsection">
      <h3>Nearby neighborhoods and market areas</h3>
      <p>{neighborhoods.join(" · ")}</p>
    </div>}
  </section>;
}

type RecommendationKey = "current_title" | "current_meta_description" | "current_h1" | "proposed_title" | "proposed_meta_description" | "proposed_h1";

function RecommendationSection({
  title,
  description,
  recommendations,
  currentKey,
  proposedKey,
  includeUnchanged = false,
}: {
  title: string;
  description: string;
  recommendations: ContentRecommendation[];
  currentKey: RecommendationKey;
  proposedKey: RecommendationKey;
  includeUnchanged?: boolean;
}) {
  const changed = recommendations.filter((item) => {
    const current = String(item[currentKey] ?? "").trim();
    const proposed = String(item[proposedKey] ?? "").trim();
    return proposed && proposed !== current;
  });
  const rows = includeUnchanged ? recommendations : changed;
  const showTextCounts = proposedKey === "proposed_title" || proposedKey === "proposed_meta_description";
  return <section className="card report-section">
    <div className="section-title"><div><h2>{title}</h2><p>{includeUnchanged ? `${recommendations.length} pages listed. ${changed.length} material changes.` : `${changed.length} material changes. Unchanged values are omitted.`} {description}</p></div></div>
    {rows.length
      ? <div className="table-wrap recommendation-table"><table><thead><tr><th>URL</th><th>Target keywords</th><th>Current</th><th>Recommended</th></tr></thead><tbody>{rows.map((item) => {
        const current = String(item[currentKey] ?? "");
        const proposed = String(item[proposedKey] ?? "");
        return <tr key={`${title}-${item.url}`}><td className="url-cell"><ReportLink url={item.url}/></td><td>{item.keywords?.join(", ") || "—"}</td><td>{item[currentKey] || "Not present"}{showTextCounts && <TextCounts text={current}/>}</td><td><WordDiff current={current} proposed={proposed}/>{showTextCounts && <TextCounts text={proposed}/>}</td></tr>;
      })}</tbody></table></div>
      : <EmptyState text="No recommendations were generated."/>}
  </section>;
}

function TextCounts({ text }: { text: string }) {
  const characters = characterCount(text);
  const words = text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return <small style={{ display: "block", marginTop: 8, color: "var(--muted)" }}>{characters} {characters === 1 ? "character" : "characters"} · {words} {words === 1 ? "word" : "words"}</small>;
}

function OnPageRecommendations({ recommendations }: { recommendations: ContentRecommendation[] }) {
  const items = recommendations.filter((item) => item.proposed_content);
  return <section className="card report-section">
    <div className="section-title"><div><h2>On-page content recommendations</h2><p>{items.length} pages with proposed copy improvements.</p></div></div>
    {items.length
      ? <div className="long-form-recommendations">{items.map((item) => {
        const isNewBlock = item.content_action === "new_block" || !item.current_body_text;
        return <details key={item.url}><summary>{stripProtocol(item.url)}</summary><small>{formatNumber(item.current_body_word_count)} current body words · {isNewBlock ? "New paragraph block" : "Light paragraph rewrite"}</small>{item.rationale && <p><strong>Why:</strong> {item.rationale}</p>}<p><strong>{isNewBlock ? "Placement:" : "Original paragraph:"}</strong> {isNewBlock ? "Add this as a new, short introductory paragraph." : item.current_body_text}</p><p><strong>{isNewBlock ? "Suggested new block:" : "Light rewrite:"}</strong> <WordDiff current={item.current_body_text ?? ""} proposed={item.proposed_content ?? ""}/></p></details>;
      })}</div>
      : <EmptyState text="No on-page copy changes were proposed."/>}
  </section>;
}

function WordDiff({ current, proposed }: { current: string; proposed: string }) {
  const currentWords = current.split(/\s+/).filter(Boolean);
  const proposedWords = proposed.split(/\s+/).filter(Boolean);
  const currentSet = new Set(currentWords.map(normalizeWord));
  return <span className="word-diff">{proposedWords.map((word, index) => {
    const changed = !currentSet.has(normalizeWord(word));
    return <span key={`${word}-${index}`}>{index ? " " : ""}{changed ? <mark><strong>{word}</strong></mark> : word}</span>;
  })}</span>;
}

function normalizeWord(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function AltTextRecommendations({ items }: { items: AltTextRecommendation[] }) {
  return <section className="card report-section">
    <div className="section-title"><div><h2>Image alt-text recommendations</h2><p>{items.length} images reviewed for accessible descriptive text.</p></div></div>
    {items.length
      ? <div className="table-wrap recommendation-table"><table><thead><tr><th>Page</th><th>Image</th><th>Current alt</th><th>Recommended alt</th><th>Length</th></tr></thead><tbody>{items.map((item, index) => <tr key={`${item.image_url}-${index}`}><td className="url-cell"><ReportLink url={item.page_url}/></td><td className="url-cell"><ReportLink url={item.image_url}/></td><td>{item.current_alt_text || "Not present"}</td><td><strong>{item.proposed_alt_text || "Review manually"}</strong></td><td>{item.alt_text_length ?? "—"}</td></tr>)}</tbody></table></div>
      : <EmptyState text="No alt-text recommendations were generated."/>}
  </section>;
}

function PageSpeedResults({
  results,
  errors,
}: {
  results: PageExperience[];
  errors: Array<{ service: string; message: string }>;
}) {
  const pageSpeedErrors = errors.filter((error) => error.service === "pagespeed");
  return <section className="card report-section">
    <div className="section-title"><div><h2>Page speed & accessibility</h2><p>Sampled mobile Lighthouse lab results. Measurement dates remain separate from report updates.</p></div></div>
    {results.length
      ? <div className="table-wrap"><table><thead><tr><th>URL</th><th>Performance</th><th>Accessibility</th><th>LCP</th><th>CLS</th><th>Blocking time</th><th>Measurement evidence</th></tr></thead><tbody>{results.map((result) => <tr key={result.url}><td className="url-cell"><ReportLink url={result.url}/></td><td>{result.performance_score ?? "—"}</td><td>{result.accessibility_score ?? "—"}</td><td>{result.metrics?.largest_contentful_paint?.display_value ?? "—"}</td><td>{result.metrics?.cumulative_layout_shift?.display_value ?? "—"}</td><td>{result.metrics?.total_blocking_time?.display_value ?? "—"}</td><td><strong>{result.measurement_status === "historical_retained" ? "Historical measurement retained" : "Recorded measurement"}</strong><p>{measurementDate(result.fetch_time || result.historical_report_date)}</p>{result.source && <p>{humanize(result.source)}</p>}{result.measurement_note && <p>{result.measurement_note}</p>}</td></tr>)}</tbody></table></div>
      : <EmptyState text={pageSpeedErrors.length ? `PageSpeed failed for ${pageSpeedErrors.length} sampled pages. See Analysis coverage above.` : "PageSpeed was not requested for this audit."}/>}
  </section>;
}

function measurementDate(value?: string) {
  if (!value) return "Measurement date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function ReportLink({ url }: { url?: string }) {
  if (!url) return <span>—</span>;
  return <a href={url} target="_blank" rel="noreferrer">{stripProtocol(url)}</a>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-analysis">{text}</p>;
}

function stripProtocol(value: string) {
  return value.replace(/^https?:\/\//, "");
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function formatNumber(value: unknown) {
  if (typeof value === "number") return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

function restorePropertyCasing(value: string | undefined, propertyName: string) {
  if (!value || !propertyName) return value ?? "";
  const terms = propertyName.match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/gi) ?? [];
  return terms
    .filter((term) => term.length > 2 && !PROPERTY_NAME_STOP_WORDS.has(term.toLowerCase()))
    .sort((left, right) => right.length - left.length)
    .reduce(
      (result, term) => result.replace(
        new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi"),
        term,
      ),
      value,
    );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PROPERTY_NAME_STOP_WORDS = new Set(["and", "the", "for", "with", "from"]);

