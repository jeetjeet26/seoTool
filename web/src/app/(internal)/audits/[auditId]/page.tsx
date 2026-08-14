import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { PageHeader, Status } from "@/components/app-shell";
import { TaskReview } from "@/components/task-review";
import { CrawlImport } from "@/components/crawl-import";
import { RunAutoRefresh } from "@/components/tools/run-progress";
import { data } from "@/lib/data";

const stages = ["Queued", "Crawling", "Analyzing", "Review ready", "Published"];

export default async function AuditPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const [audit, tasks, events] = await Promise.all([
    data.getAudit(auditId),
    data.getTasks(auditId),
    data.getAuditEvents(auditId),
  ]);
  if (!audit) notFound();
  return <>
    <RunAutoRefresh active={audit.status === "queued" || audit.status === "running"}/>
    <div className="breadcrumbs"><Link href="/dashboard">Dashboard</Link><Icon name="chevron"/><span>{audit.id}</span></div>
    <PageHeader eyebrow={audit.id} title={audit.clientName} description={audit.url} action={<div className="action-row"><Status value={audit.status}/>{["review", "published"].includes(audit.status) && <Link className="button primary" href={`/audits/${audit.id}/report`}>Open report</Link>}</div>} />
    {audit.status === "failed" && audit.failedReason && <div className="notice danger"><Icon name="alert"/><span><strong>Audit stopped during processing</strong>{audit.failedReason}</span></div>}
    <section className="card stage-card"><div className="section-title"><div><h2>Audit progress</h2><p>{audit.status === "failed" ? "Action required before processing can continue." : audit.status === "cancelled" ? "This audit was cancelled." : "The latest stage and pipeline activity."}</p></div><span>{Math.min(audit.stage, 5)} of 5</span></div>
      <ol className="stages">{stages.map((stage, index) => <li key={stage} className={index < audit.stage ? "complete" : index === audit.stage ? "current" : ""}><span>{index < audit.stage ? <Icon name="check"/> : index + 1}</span><strong>{stage}</strong></li>)}</ol>
    </section>
    <div className="two-column">
      <section className="card"><div className="section-title"><div><h2>Scan summary</h2><p>Coverage collected in this run.</p></div></div><div className="summary-grid"><div><strong>{audit.pages}</strong><span>Pages crawled</span></div><div><strong>{audit.score ?? "—"}</strong><span>Health score</span></div><div><strong>{audit.summary?.finding_count ?? 0}</strong><span>Findings</span></div><div><strong>{audit.stage * 20}%</strong><span>Pipeline progress</span></div></div></section>
      <section className="card"><div className="section-title"><div><h2>Activity log</h2><p>Latest crawler events.</p></div></div>{events.length ? <div className="log-list">{events.map((event) => <p key={event.id}><time>{formatTime(event.createdAt)}</time>{event.message ?? event.eventType}</p>)}</div> : <div className="empty"><strong>No activity yet</strong><p>Worker events will appear after the audit is claimed.</p></div>}</section>
    </div>
    {audit.status !== "queued" && audit.status !== "running" && <CrawlImport auditId={auditId}/>}
    <section className="card report-section"><div className="section-title"><div><h2>Client task list</h2><p>Choose exactly which approved tasks appear in the no-login client portal.</p></div></div><TaskReview auditId={auditId} tasks={tasks}/></section>
  </>;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", { timeStyle: "medium" }).format(date);
}
