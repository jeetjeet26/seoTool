import type {
  AltTextRecommendation,
  AuditSummary,
  ContentRecommendation,
  KeywordStrategyItem,
  PageExperience,
} from "@/lib/data/types";

export function AuditInsights({ summary }: { summary: AuditSummary }) {
  const keywords = filterReportKeywords(
    summary.keyword_strategy ?? [],
    summary.target_location ?? "",
  );
  const recommendations = summary.content_recommendations ?? [];
  const altText = summary.alt_text_recommendations ?? [];
  const pageExperience = summary.page_experience ?? [];
  const errors = summary.enrichment_errors ?? [];

  return <>
    <ServiceStatus errors={errors} />
    <SiteInventory summary={summary} />
    <KeywordStrategy keywords={keywords} />
    <SearchVisibility summary={summary} />
    <RecommendationSection
      title="Title tag recommendations"
      description={`${recommendations.length} crawled pages with current and proposed title tags.`}
      recommendations={recommendations}
      currentKey="current_title"
      proposedKey="proposed_title"
    />
    <RecommendationSection
      title="Meta description recommendations"
      description={`${recommendations.length} crawled pages with current and proposed descriptions.`}
      recommendations={recommendations}
      currentKey="current_meta_description"
      proposedKey="proposed_meta_description"
    />
    <RecommendationSection
      title="H1 recommendations"
      description={`${recommendations.length} crawled pages with current and proposed primary headings.`}
      recommendations={recommendations}
      currentKey="current_h1"
      proposedKey="proposed_h1"
    />
    <OnPageRecommendations recommendations={recommendations} />
    <AltTextRecommendations items={altText} />
    <PageSpeedResults results={pageExperience} errors={errors} />
  </>;
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
    ["Crawled HTML pages", inventory.page_count],
    ["Sitemap URLs", inventory.sitemap_url_count],
    ["Sitemap-only URLs", inventory.sitemap_only_count],
    ["Crawl-only URLs", inventory.crawl_only_count],
    ["Missing H1", inventory.missing_h1_count],
    ["Duplicate titles", inventory.duplicate_title_count],
    ["Duplicate descriptions", inventory.duplicate_description_count],
    ["Images missing alt text", inventory.images_missing_alt_count],
  ] as const;
  return <section className="card report-section">
    <div className="section-title"><div><h2>Site inventory</h2><p>Crawl and XML sitemap reconciliation.</p></div></div>
    <div className="insight-metrics">
      {metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{formatNumber(value)}</strong></article>)}
    </div>
  </section>;
}

function KeywordStrategy({ keywords }: { keywords: KeywordStrategyItem[] }) {
  return <section className="card report-section">
    <div className="section-title"><div><h2>Keyword research & strategy</h2><p>{keywords.length} Semrush-backed ranking and related-keyword opportunities with target pages.</p></div></div>
    {keywords.length
      ? <div className="table-wrap"><table><thead><tr><th>Keyword</th><th>Source</th><th>Intent</th><th>Position</th><th>Volume</th><th>CPC</th><th>Difficulty</th><th>Target page</th></tr></thead><tbody>
        {keywords.map((item) => <tr key={`${item.source}-${item.keyword}`}><td><strong>{item.keyword}</strong></td><td>{item.source}</td><td>{item.intent}</td><td>{item.position ?? "—"}</td><td>{formatNumber(item.volume)}</td><td>{formatCurrency(item.cpc)}</td><td>{formatNumber(item.difficulty)}</td><td className="url-cell"><ReportLink url={item.assigned_page}/></td></tr>)}
      </tbody></table></div>
      : <EmptyState text="Semrush returned no usable keyword opportunities."/>}
  </section>;
}

function SearchVisibility({ summary }: { summary: AuditSummary }) {
  const semrush = summary.semrush ?? {};
  const competitors = summary.competitors ?? [];
  const backlinks = summary.backlinks ?? {};
  return <section className="card report-section">
    <div className="section-title"><div><h2>Search visibility</h2><p>Semrush organic visibility, backlink authority, and competitors.</p></div></div>
    <div className="insight-metrics">
      {Object.entries(semrush).map(([key, value]) => <article key={key}><span>{humanize(key)}</span><strong>{formatNumber(value)}</strong></article>)}
      {Object.entries(backlinks).map(([key, value]) => <article key={key}><span>{humanize(key)}</span><strong>{formatNumber(value)}</strong></article>)}
    </div>
    <div className="subsection">
      <h3>Compare domains</h3>
      {competitors.length
        ? <div className="table-wrap"><table><thead><tr><th>Domain</th><th>Source</th><th>Relevance</th><th>Shared keywords</th><th>Organic keywords</th><th>Traffic</th></tr></thead><tbody>{competitors.map((item) => <tr key={item.domain}><td><strong>{item.domain}</strong></td><td>{item.source === "provided" ? "Provided" : "Semrush"}</td><td>{item.competition_level}</td><td>{formatNumber(item.common_keywords)}</td><td>{formatNumber(item.organic_keywords)}</td><td>{formatNumber(item.organic_traffic)}</td></tr>)}</tbody></table></div>
        : <EmptyState text="No competitor domains were provided and Semrush did not discover enough organic overlap for this audit."/>}
    </div>
  </section>;
}

type RecommendationKey = "current_title" | "current_meta_description" | "current_h1" | "proposed_title" | "proposed_meta_description" | "proposed_h1";

function RecommendationSection({
  title,
  description,
  recommendations,
  currentKey,
  proposedKey,
}: {
  title: string;
  description: string;
  recommendations: ContentRecommendation[];
  currentKey: RecommendationKey;
  proposedKey: RecommendationKey;
}) {
  return <section className="card report-section">
    <div className="section-title"><div><h2>{title}</h2><p>{description}</p></div></div>
    {recommendations.length
      ? <div className="table-wrap recommendation-table"><table><thead><tr><th>URL</th><th>Target keywords</th><th>Current</th><th>Recommended</th></tr></thead><tbody>{recommendations.map((item) => <tr key={`${title}-${item.url}`}><td className="url-cell"><ReportLink url={item.url}/></td><td>{item.keywords?.join(", ") || "—"}</td><td>{item[currentKey] || "Not present"}</td><td><strong>{item[proposedKey] || "No change proposed"}</strong></td></tr>)}</tbody></table></div>
      : <EmptyState text="No recommendations were generated."/>}
  </section>;
}

function OnPageRecommendations({ recommendations }: { recommendations: ContentRecommendation[] }) {
  const items = recommendations.filter((item) => item.proposed_content);
  return <section className="card report-section">
    <div className="section-title"><div><h2>On-page content recommendations</h2><p>{items.length} pages with proposed copy improvements.</p></div></div>
    {items.length
      ? <div className="long-form-recommendations">{items.map((item) => <details key={item.url}><summary>{stripProtocol(item.url)}</summary><small>{formatNumber(item.current_body_word_count)} current body words</small>{item.rationale && <p><strong>Why:</strong> {item.rationale}</p>}<p><strong>Recommended copy:</strong> {item.proposed_content}</p></details>)}</div>
      : <EmptyState text="No on-page copy changes were proposed."/>}
  </section>;
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
    <div className="section-title"><div><h2>Page speed & accessibility</h2><p>Sampled mobile Lighthouse results.</p></div></div>
    {results.length
      ? <div className="table-wrap"><table><thead><tr><th>URL</th><th>Performance</th><th>Accessibility</th><th>LCP</th><th>CLS</th><th>Blocking time</th></tr></thead><tbody>{results.map((result) => <tr key={result.url}><td className="url-cell"><ReportLink url={result.url}/></td><td>{result.performance_score ?? "—"}</td><td>{result.accessibility_score ?? "—"}</td><td>{result.metrics?.largest_contentful_paint?.display_value ?? "—"}</td><td>{result.metrics?.cumulative_layout_shift?.display_value ?? "—"}</td><td>{result.metrics?.total_blocking_time?.display_value ?? "—"}</td></tr>)}</tbody></table></div>
      : <EmptyState text={pageSpeedErrors.length ? `PageSpeed failed for ${pageSpeedErrors.length} sampled pages. See Analysis coverage above.` : "PageSpeed was not requested for this audit."}/>}
  </section>;
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

const HOUSING_TERMS = new Set([
  "apartment", "apartments", "rent", "rental", "rentals", "studio", "bedroom",
  "bedrooms", "loft", "lofts", "flat", "flats", "housing", "townhome", "townhomes",
]);

function filterReportKeywords(items: KeywordStrategyItem[], location: string) {
  const locationTokens = new Set(
    location.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2) ?? [],
  );
  return items.filter((item) => {
    if (item.source === "ranking" || item.source === "seed") return true;
    const tokens = new Set(item.keyword.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    return [...tokens].some((token) => HOUSING_TERMS.has(token))
      && [...tokens].some((token) => locationTokens.has(token));
  });
}
