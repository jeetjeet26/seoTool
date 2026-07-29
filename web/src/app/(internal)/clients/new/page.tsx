import Link from "next/link";

import { createClient } from "@/actions/clients";
import { PageHeader } from "@/components/app-shell";

export const metadata = { title: "New client" };

export default function NewClientPage() {
  return (
    <div className="narrow-page">
      <PageHeader
        eyebrow="New client"
        title="Add a client website"
        description="Create the client record used for audits and reports."
      />
      <form className="form-card" action={createClient}>
        <div className="form-section">
          <div>
            <span className="step-number">1</span>
            <h2>Client details</h2>
            <p>Enter the client and primary website.</p>
          </div>
          <div className="fields">
            <label>
              Client name
              <input name="name" required autoComplete="organization" />
            </label>
            <label>
              Website URL
              <input
                name="websiteUrl"
                type="url"
                required
                placeholder="https://example.com"
              />
            </label>
            <label>
              Notes
              <input
                name="notes"
                placeholder="Location, contact, or account notes"
              />
            </label>
          </div>
        </div>
        <div className="form-actions">
          <Link className="button secondary" href="/clients">
            Cancel
          </Link>
          <button className="button primary" type="submit">
            Add client
          </button>
        </div>
      </form>
    </div>
  );
}
