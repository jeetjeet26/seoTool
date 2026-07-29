import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { PageHeader, Status } from "@/components/app-shell";
import { data } from "@/lib/data";

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const [client, audits] = await Promise.all([data.getClient(clientId), data.getAudits()]);
  if (!client) notFound();
  const clientAudits = audits.filter((audit) => audit.clientId === client.id);
  return <>
    <div className="breadcrumbs"><Link href="/clients">Clients</Link><Icon name="chevron"/><span>{client.name}</span></div>
    <PageHeader title={client.name} description={`${client.website} · ${client.location}`} action={<Link className="button primary" href="/audits/new"><Icon name="plus"/>New audit</Link>} />
    <div className="two-column">
      <section className="card"><div className="section-title"><div><h2>Audit history</h2><p>All scans associated with this client.</p></div></div>{clientAudits.length ? <div className="list">{clientAudits.map((audit) => <Link href={`/audits/${audit.id}`} className="list-row" key={audit.id}><div><strong>{audit.createdAt}</strong><small>{audit.pages} pages · Score {audit.score ?? "pending"}</small></div><Status value={audit.status}/><Icon name="chevron"/></Link>)}</div> : <div className="empty"><h3>No audits yet</h3><p>Run the first scan to establish a baseline.</p></div>}</section>
      <aside className="card detail-card"><h2>Client details</h2><dl><div><dt>Primary contact</dt><dd>{client.contact}</dd></div><div><dt>Website</dt><dd><a href={`https://${client.website}`} target="_blank" rel="noreferrer">{client.website}</a></dd></div><div><dt>Location</dt><dd>{client.location}</dd></div></dl><Link className="button secondary full" href={`/clients/${client.id}/intake`}>Intake questionnaire</Link></aside>
    </div>
  </>;
}
