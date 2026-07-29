import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader, Status } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/auth/user";
import { data } from "@/lib/data";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [audits, profile] = await Promise.all([
    data.getAudits(),
    getCurrentProfile(),
  ]);
  const activeAudits = audits.filter((audit) =>
    ["queued", "running"].includes(audit.status),
  ).length;
  const pagesScanned = audits.reduce((total, audit) => total + audit.pages, 0);
  const criticalIssues = audits.reduce(
    (total, audit) =>
      total + (audit.summary?.severity_counts?.critical ?? 0),
    0,
  );
  const scoredAudits = audits.filter(
    (audit): audit is typeof audit & { score: number } => audit.score !== null,
  );
  const averageScore = scoredAudits.length
    ? Math.round(
        scoredAudits.reduce((total, audit) => total + audit.score, 0) /
          scoredAudits.length,
      )
    : null;
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  return <>
    <PageHeader eyebrow={today} title={`Welcome, ${profile?.displayName ?? "team member"}`} description="Here’s what needs attention across your audit workspace." action={<Link className="button primary" href="/audits/new"><Icon name="plus"/>Run an audit</Link>} />
    <section className="metrics" aria-label="Workspace metrics">
      <article><span>Active audits</span><strong>{activeAudits}</strong><small>Queued or currently running</small></article>
      <article><span>Pages scanned</span><strong>{pagesScanned}</strong><small>Across {audits.length} audit{audits.length === 1 ? "" : "s"}</small></article>
      <article><span>Open critical issues</span><strong>{criticalIssues}</strong><small>Across completed analyses</small></article>
      <article><span>Average score</span><strong>{averageScore ?? "—"}</strong><small>{scoredAudits.length} scored audit{scoredAudits.length === 1 ? "" : "s"}</small></article>
    </section>
    <section className="card" id="recent-audits">
      <div className="section-title"><div><h2>Recent audits</h2><p>Latest crawl activity and client deliverables.</p></div><Link className="text-link" href="/audits">View all <Icon name="chevron"/></Link></div>
      <div className="table-wrap"><table><thead><tr><th>Client</th><th>Status</th><th>Pages</th><th>Score</th><th>Updated</th><th><span className="sr-only">Open</span></th></tr></thead>
      <tbody>{audits.map((audit) => <tr key={audit.id}><td><Link className="row-title" href={`/audits/${audit.id}`}><span className="client-icon">{audit.clientName.slice(0, 2).toUpperCase()}</span><span><strong>{audit.clientName}</strong><small>{audit.url.replace("https://", "")}</small></span></Link></td><td><Status value={audit.status}/></td><td>{audit.pages}</td><td>{audit.score ?? "—"}</td><td>{formatDate(audit.updatedAt)}</td><td><Link className="icon-link" aria-label={`Open ${audit.clientName} audit`} href={`/audits/${audit.id}`}><Icon name="chevron"/></Link></td></tr>)}</tbody></table>{!audits.length && <div className="empty"><strong>No audits yet</strong><p>Run your first audit to populate workspace metrics and reports.</p></div>}</div>
    </section>
  </>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}
