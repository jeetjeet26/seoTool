import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/app-shell";
import { AuditInsights } from "@/components/audit-insights";
import { FindingsTable, ReportActions } from "@/components/report-controls";
import { data } from "@/lib/data";
import type { AuditSummary } from "@/lib/data/types";

export default async function ReportPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const [audit, findings, audits, toolRuns] = await Promise.all([
    data.getAudit(auditId),
    data.getFindings(auditId),
    data.getAudits(),
    data.getToolRuns(),
  ]);
  if (!audit) notFound();
  const clientToolRuns = toolRuns.filter(
    (run) =>
      run.status === "completed" &&
      (run.auditId === auditId || run.clientId === audit.clientId),
  );
  const summary = audit.summary ?? {};
  const categoryCards = buildCategoryCards(summary);
  const history = audits
    .filter((item) => item.clientId === audit.clientId && item.score !== null)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-4);
  const preparedDate = formatDate(audit.updatedAt, "long");

  return <>
    <div className="breadcrumbs"><Link href={`/audits/${auditId}`}>Audit {auditId}</Link><Icon name="chevron"/><span>Report</span></div>
    <PageHeader eyebrow="Technical SEO report" title={audit.clientName} description={`Prepared ${preparedDate} · ${audit.pages} pages analyzed`} action={<ReportActions auditId={auditId}/>}/>
    <section className="report-hero">
      <div className="score-panel"><span className="score-ring large-score">{audit.score ?? "—"}<small>/100</small></span><div><p>Overall health</p><strong>{healthLabel(audit.score)}</strong><small>{audit.score === null ? "Available after analysis" : `${findings.length} recorded finding${findings.length === 1 ? "" : "s"}`}</small></div></div>
      <div><h2>Executive summary</h2><p>{executiveSummary(summary, findings.length)}</p></div>
    </section>
    <section className="category-grid" aria-label="SEO category scores">
      {categoryCards.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong><div className="mini-progress"><span style={{ width: `${item.percent}%` }}/></div><small>{item.note}</small></article>)}
    </section>
    <section className="card report-section"><div className="section-title"><div><h2>Prioritized findings</h2><p>Filter issues, open affected URLs, and select approved findings for task review.</p></div></div><FindingsTable findings={findings} auditId={auditId}/></section>
    <AuditInsights summary={summary}/>
    <div className="two-column report-section">
      <section className="card"><div className="section-title"><div><h2>Fair Housing compliance</h2><p>AI-generated copy remains subject to human approval.</p></div></div><div className="recommendations"><article><span>Review status</span><strong>Human review required before publishing</strong><p>Recommendations are generated with Fair Housing language safeguards. Confirm accuracy, accessibility, brand voice, and legal suitability before implementation.</p></article></div></section>
      <section className="card"><div className="section-title"><div><h2>Developer handoff</h2><p>Implementation-ready exports.</p></div></div><div className="recommendations"><article><span>Complete audit export</span><strong>Download the Excel workbook or CSV from the audit workspace.</strong><p>The workbook contains keyword, metadata, heading, on-page, alt-text, technical, PageSpeed, recap, and glossary sheets when data is available.</p></article></div></section>
    </div>
    {clientToolRuns.length > 0 && <section className="card report-section"><div className="section-title"><div><h2>Tool outputs for this client</h2><p>Approved keyword, metadata, schema, and llms.txt work from the tools workspace.</p></div></div><div className="recommendations">{clientToolRuns.slice(0, 6).map((run) => <article key={run.id}><span>{run.toolType.replaceAll("_", " ")}</span><strong><Link className="text-link" href={`/tools/runs/${run.id}`}>{run.name}</Link></strong><p>Completed {formatDate(run.updatedAt, "long")} — open the run to review approved items and exports.</p></article>)}</div></section>}
    <section className="card report-section"><div className="section-title"><div><h2>Audit history</h2><p>Score movement across completed scans.</p></div></div><div className="history">{(history.length ? history : [audit]).map((item, index, list) => <span key={item.id} className={index === list.length - 1 ? "active" : ""} style={{height:`${Math.max(30, item.score ?? 0)}%`}}><b>{item.score ?? "—"}</b><small>{formatDate(item.createdAt, "short")}</small></span>)}</div></section>
  </>;
}

function buildCategoryCards(summary: AuditSummary) {
  const counts = summary.category_counts ?? {};
  const entries = Object.entries(counts);
  const total = Math.max(1, summary.finding_count ?? entries.reduce((sum, [, value]) => sum + value, 0));
  if (!entries.length) {
    return [
      { label: "Crawlability", value: 0, percent: 100, note: "Awaiting crawl" },
      { label: "Metadata", value: 0, percent: 100, note: "Awaiting crawl" },
      { label: "Content", value: 0, percent: 100, note: "Awaiting crawl" },
      { label: "Links", value: 0, percent: 100, note: "Awaiting crawl" },
      { label: "Performance", value: 0, percent: 100, note: "Awaiting analysis" },
      { label: "Accessibility", value: 0, percent: 100, note: "Awaiting analysis" },
    ];
  }
  return entries.slice(0, 6).map(([label, value]) => ({
    label: label.replaceAll("_", " "),
    value,
    percent: Math.max(8, 100 - Math.round((value / total) * 100)),
    note: `${value} finding${value === 1 ? "" : "s"}`,
  }));
}

function executiveSummary(summary: AuditSummary, findingCount: number) {
  const critical = summary.severity_counts?.critical ?? 0;
  const high = summary.severity_counts?.high ?? 0;
  if (!findingCount) {
    return "No crawl findings are available yet. Run the audit pipeline to populate this report with page-level evidence and prioritized recommendations.";
  }
  return `The audit identified ${findingCount} issue occurrences, including ${critical} critical and ${high} high-severity items. Review the prioritized findings below, confirm AI-assisted recommendations, and publish only approved remediation tasks to the client portal.`;
}

function healthLabel(score: number | null) {
  if (score === null) return "Awaiting analysis";
  if (score >= 90) return "Healthy";
  if (score >= 70) return "Needs attention";
  return "Needs immediate attention";
}

function formatDate(value: string, style: "long" | "short") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(
    "en-US",
    style === "long" ? { dateStyle: "long" } : { month: "short" },
  ).format(date);
}
