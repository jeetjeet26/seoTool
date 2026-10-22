import Link from "next/link";

import type { Audit } from "@/lib/data/types";

export function AuditArchiveNotice({ archive }: { archive: Audit["archive"] }) {
  if (!archive) return null;

  return (
    <div className="notice" role="note">
      <div>
        <strong>Archived audit</strong>
        <p>{archive.reason || "This earlier audit is retained for reference."}</p>
        {archive.replacementAuditId ? (
          <Link className="text-link" href={`/audits/${archive.replacementAuditId}/report`}>
            Open the current report
          </Link>
        ) : (
          <Link className="text-link" href="/audits">View current audits</Link>
        )}
      </div>
    </div>
  );
}
