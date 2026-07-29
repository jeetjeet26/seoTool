import Link from "next/link";

import { PageHeader, Status } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { data } from "@/lib/data";

export const metadata = { title: "Audits" };

export default async function AuditsPage() {
  const audits = await data.getAudits();

  return (
    <>
      <PageHeader
        title="Audits"
        description="Review current and completed site scans."
        action={
          <Link className="button primary" href="/audits/new">
            <Icon name="plus" />
            New audit
          </Link>
        }
      />
      <section className="card">
        {audits.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Pages</th>
                  <th>Score</th>
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
                    </td>
                    <td>
                      <Status value={audit.status} />
                    </td>
                    <td>{audit.pages}</td>
                    <td>{audit.score ?? "—"}</td>
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
            <strong>No audits yet</strong>
            <p>Create an audit after adding your first client.</p>
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
