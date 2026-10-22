import Link from "next/link";
import { onboardingProgress, needsAdvisory } from "@/lib/onboarding";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { PageHeader, Status } from "@/components/app-shell";
import { data } from "@/lib/data";

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const [client, audits] = await Promise.all([data.getClient(clientId), data.getAudits()]);
  if (!client) notFound();
  const progress = onboardingProgress(client.onboarding);
  const clientAudits = audits.filter((audit) => audit.clientId === client.id);
  return <>
    <div className="breadcrumbs"><Link href="/clients">Clients</Link><Icon name="chevron"/><span>{client.name}</span></div>
    <PageHeader title={client.name} description={`${client.website} · ${client.location}`} action={<Link className="button primary" href={`/audits/new?clientId=${client.id}`}><Icon name="plus"/>New audit</Link>} />
    <section className="card onboarding-client-summary"><div><h2>SEO onboarding</h2><p>{progress.done} of {progress.total} checkpoints complete · {client.onboarding?.fields.audit_status || "Audit not started"}</p><p>{client.onboarding?.fields.assigned_team || "Team not assigned"} · {client.onboarding?.fields.monthly_hours || "—"} contracted hours / month · Next report: {client.onboarding?.fields.next_report || "Not scheduled"}</p>{client.onboarding && needsAdvisory(client.onboarding) && <p>CMS-dependent work requires a client/vendor handoff.</p>}</div><Link className="button primary" href={`/clients/${client.id}/intake`}>Continue onboarding</Link></section>
    <div className="two-column">
      <section className="card"><div className="section-title"><div><h2>Audit history</h2><p>Current scans for this client. <Link className="text-link" href="/audits?view=archived">View archived audits</Link>.</p></div></div>{clientAudits.length ? <div className="list">{clientAudits.map((audit) => <Link href={`/audits/${audit.id}`} className="list-row" key={audit.id}><div><strong>{audit.createdAt}</strong><small>{audit.pages} pages · {audit.summary?.finding_count ?? 0} findings</small></div><Status value={audit.status}/><Icon name="chevron"/></Link>)}</div> : <div className="empty"><h3>No current audits</h3><p>Create a scan or open the archived audits.</p></div>}</section>
      <aside className="card detail-card"><h2>Client details</h2><dl><div><dt>Primary contact</dt><dd>{client.contact}</dd></div><div><dt>Website</dt><dd><a href={client.website.startsWith("http") ? client.website : `https://${client.website}`} target="_blank" rel="noreferrer">{client.website}</a></dd></div><div><dt>Location</dt><dd>{client.location}</dd></div></dl><Link className="button secondary full" href={`/clients/${client.id}/intake`}>SEO onboarding</Link></aside>
    </div>
  </>;
}
