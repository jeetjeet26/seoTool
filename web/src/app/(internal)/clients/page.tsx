import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/app-shell";
import { data } from "@/lib/data";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const clients = await data.getClients();
  return <>
    <PageHeader title="Clients" description="Manage websites, contacts, and audit history." action={<Link className="button primary" href="/clients/new"><Icon name="plus"/>Add client</Link>} />
    {clients.length ? <section className="client-grid">{clients.map((client) => <Link className="client-card" href={`/clients/${client.id}`} key={client.id}>
      <div className="client-card-head"><span className="client-icon large">{client.name.slice(0, 2).toUpperCase()}</span><Icon name="chevron"/></div>
      <h2>{client.name}</h2><p>{client.website}</p>
      <dl><div><dt>Location</dt><dd>{client.location}</dd></div><div><dt>Contact</dt><dd>{client.contact}</dd></div><div><dt>Active audits</dt><dd>{client.activeAudits}</dd></div></dl>
    </Link>)}</section> : <section className="card empty"><strong>No clients yet</strong><p>Add your first client before creating an audit.</p></section>}
  </>;
}
