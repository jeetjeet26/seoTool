import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/app-shell";
import { AuditInsights } from "@/components/audit-insights";
import { FindingsTable, ReportActions } from "@/components/report-controls";
import { data } from "@/lib/data";
import type { AuditSummary } from "@/lib/data/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ReportPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const [audit, findings, audits, toolRuns] = await Promise.all([
    data.getAudit(auditId),
    data.getFindings(auditId),
    data.getAudits(),
    data.getToolRuns(),
  ]);
  if (!audit) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: approvedTargets } = await supabase
    .from("keyword_targets")
    .select("id,keyword,canonical_url,role")
    .eq("client_id", audit.clientId)
    .eq("status", "approved")
    .order("canonical_url");
  const { data: artifactRows } = await supabase
    .from("artifacts")
    .select("id,kind,object_path,byte_size")
    .eq("audit_id", auditId)
    .order("created_at");
  const artifacts = await Promise.all(
    (artifactRows ?? []).map(async (artifact) => {
      const { data: signed } = await supabase.storage
        .from("audit-artifacts")
        .createSignedUrl(artifact.object_path, 3600);
      return { ...artifact, url: signed?.signedUrl };
    }),
  );
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
    <PageHeader eyebrow="Technical SEO report" title={summary.property_context?.name || audit.clientName} description={`${summary.property_context?.location ? `${summary.property_context.location} · ` : ""}Prepared ${preparedDate} · ${audit.pages} pages analyzed`} action={<ReportActions auditId={auditId}/>}/>
    <section className="report-hero">
      <div className="score-panel"><span className="score-ring large-score">{audit.score ?? "—"}<small>/100</small></span><div><p>Overall health</p><strong>{healthLabel(audit.score)}</strong><small>{audit.score === null ? "Available after analysis" : `${findings.length} recorded finding${findings.length === 1 ? "" : "s"}`}</small></div></div>
      <div><h2>Executive summary</h2><p>{executiveSummary(summary, findings.length)}</p></div>
    </section>
    <section className="category-grid" aria-label="SEO category scores">
      {categoryCards.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></article>)}
    </section>
    <section className="card report-section"><div className="section-title"><div><h2>Prioritized findings</h2><p>Filter issues, open affected URLs, and select approved findings for task review.</p></div></div><FindingsTable findings={findings} auditId={auditId}/></section>
    <AuditInsights auditId={auditId} summary={summary} approvedTargets={(approvedTargets ?? []) as Array<{id:string;keyword:string;canonical_url:string;role:"primary"|"secondary"}>}/>
    <div className="two-column report-section">
      {summary.fair_housing_enabled && <section className="card"><div className="section-title"><div><h2>Fair Housing compliance</h2><p>This client has housing-specific safeguards enabled.</p></div></div><div className="recommendations"><article><span>Review status</span><strong>Human review required before publishing</strong><p>Confirm accuracy, brand voice, and legal suitability before implementation.</p></article></div></section>}
      <section className="card"><div className="section-title"><div><h2>Developer handoff</h2><p>Implementation-ready exports.</p></div></div><div className="recommendations"><article><span>Complete audit export</span><strong>Download the Excel workbook or CSV from the audit workspace.</strong><p>The workbook contains keyword, metadata, heading, on-page, alt-text, technical, PageSpeed, recap, and glossary sheets when data is available.</p></article></div></section>
    </div>
    {clientToolRuns.length > 0 && <section className="card report-section"><div className="section-title"><div><h2>Tool outputs for this client</h2><p>Approved keyword, metadata, schema, and llms.txt work from the tools workspace.</p></div></div><div className="recommendations">{clientToolRuns.slice(0, 6).map((run) => <article key={run.id}><span>{run.toolType.replaceAll("_", " ")}</span><strong><Link className="text-link" href={`/tools/runs/${run.id}`}>{run.name}</Link></strong><p>Completed {formatDate(run.updatedAt, "long")} — open the run to review approved items and exports.</p></article>)}</div></section>}
    <section className="card report-section"><div className="section-title"><div><h2>Audit history</h2><p>Score movement across completed scans.</p></div></div><div className="history">{(history.length ? history : [audit]).map((item, index, list) => <span key={item.id} className={index === list.length - 1 ? "active" : ""} style={{height:`${Math.max(30, item.score ?? 0)}%`}}><b>{item.score ?? "—"}</b><small>{formatDate(item.createdAt, "short")}</small></span>)}</div></section>
    {artifacts.length > 0 && <section className="card report-section"><div className="section-title"><div><h2>Source files and exports</h2><p>Download the complete Screaming Frog exports, saved crawl when available, and generated report files.</p></div></div><div className="artifact-list">{artifacts.map((artifact) => artifact.url && <a key={artifact.id} className="artifact-link" href={artifact.url}><strong>{artifact.object_path.split("/").at(-1)}</strong><span>{artifact.kind} · {formatBytes(artifact.byte_size)}</span></a>)}</div></section>}
  </>;
}

function buildCategoryCards(summary: AuditSummary) {
  const counts = summary.category_counts ?? {};
  const entries = Object.entries(counts);
  if (!entries.length) {
    return [
      { label: "Crawlability", value: 0, note: "Awaiting crawl" },
      { label: "Metadata", value: 0, note: "Awaiting crawl" },
      { label: "Content", value: 0, note: "Awaiting crawl" },
      { label: "Links", value: 0, note: "Awaiting crawl" },
      { label: "Performance", value: 0, note: "Awaiting analysis" },
      { label: "Accessibility", value: 0, note: "Awaiting analysis" },
    ];
  }
  return entries.slice(0, 6).map(([label, value]) => ({
    label: label.replaceAll("_", " "),
    value,
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

function formatBytes(value: number | null) {
  if (!value) return "0 KB";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024).toFixed(1)} KB`;
}
