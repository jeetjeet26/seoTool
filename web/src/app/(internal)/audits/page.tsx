import Link from "next/link";

import { PageHeader, Status } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { data } from "@/lib/data";

export const metadata = { title: "Audits" };

export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ view }, allAudits] = await Promise.all([
    searchParams,
    data.getAudits({ includeArchived: true }),
  ]);
  const showArchived = view === "archived";
  const audits = allAudits.filter((audit) => showArchived ? Boolean(audit.archive) : !audit.archive);
  const archivedCount = allAudits.filter((audit) => audit.archive).length;

  return (
    <>
      <PageHeader
        title={showArchived ? "Archived audits" : "Audits"}
        description={showArchived ? "Earlier reports remain available with their history and shared links." : "Review current and completed site scans."}
        action={
          <Link className="button primary" href="/audits/new">
            <Icon name="plus" />
            New audit
          </Link>
        }
      />
      <nav className="action-row" aria-label="Audit views">
        <Link className="button secondary" href="/audits" aria-current={!showArchived ? "page" : undefined}>Current audits</Link>
        <Link className="button secondary" href="/audits?view=archived" aria-current={showArchived ? "page" : undefined}>Archived ({archivedCount})</Link>
      </nav>
      <section className="card">
        {audits.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Pages</th>
                  <th>Created</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {audits.map((audit) => (
                  <tr key={audit.id}>
                    <td>
                      <strong>{audit.clientName}</strong>
                      <small>{audit.url}</small>
                      {audit.archive?.replacementAuditId && (
                        <small><Link className="text-link" href={`/audits/${audit.archive.replacementAuditId}/report`}>Open current report</Link></small>
                      )}
                    </td>
                    <td>
                      <Status value={audit.status} />
                    </td>
                    <td>{audit.pages}</td>
                    <td>{formatDate(audit.createdAt)}</td>
                    <td>
                      <Link
                        className="icon-link"
                        href={`/audits/${audit.id}`}
                        aria-label={`Open ${audit.clientName} audit`}
                      >
                        <Icon name="chevron" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>{showArchived ? "No archived audits" : "No audits yet"}</strong>
            <p>{showArchived ? "Archived reports will appear here." : "Create an audit after adding your first client."}</p>
          </div>
        )}
      </section>
    </>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}
