"use client";

import { useActionState } from "react";

import { queueAudit, type QueueAuditState } from "@/actions/audits";

const initialState: QueueAuditState = {};

export function AuditForm() {
  const [state, action, pending] = useActionState(queueAudit, initialState);
  return (
    <form className="form-card" action={action}>
      {state.message && <div className="notice success" role="status"><strong>Audit queued.</strong><span>{state.message}</span></div>}
      {state.error && <div className="notice" role="alert"><strong>Unable to queue audit.</strong><span>{state.error}</span></div>}
      <div className="form-section">
        <div><span className="step-number">1</span><h2>Target</h2><p>Enter the client and starting URL.</p></div>
        <div className="fields">
          <label>Client name<input name="clientName" required autoComplete="organization" placeholder="Client or property name" /></label>
          <label>Website URL<input name="targetUrl" type="url" required placeholder="https://example.com" /></label>
          <div className="field-row"><label>City<input name="targetCity" required placeholder="Austin" /></label><label>State or region<input name="targetRegion" placeholder="Texas" maxLength={160} /></label></div>
          <label>
            Competitor domains <span className="label-hint">Optional · one per line · maximum 10</span>
            <textarea
              name="competitorDomains"
              rows={4}
              maxLength={2000}
              placeholder={"competitor-one.com\ncompetitor-two.com"}
            />
          </label>
        </div>
      </div>
      <div className="form-section">
        <div><span className="step-number">2</span><h2>Scan settings</h2><p>Control crawl depth and optional checks.</p></div>
        <div className="fields">
          <label>Page limit <span className="label-hint">Maximum 1,000</span><input name="pageLimit" type="number" min="1" max="1000" defaultValue="250" required /></label>
          <label className="toggle-row"><span><strong>Performance checks</strong><small>Collect Core Web Vitals signals on sampled pages.</small></span><input name="runPerformance" type="checkbox" defaultChecked /></label>
          <label className="toggle-row"><span><strong>Accessibility checks</strong><small>Run automated WCAG-oriented checks.</small></span><input name="runAccessibility" type="checkbox" defaultChecked /></label>
        </div>
      </div>
      <div className="form-actions"><a className="button secondary" href="/dashboard">Cancel</a><button className="button primary" type="submit" disabled={pending}>{pending ? "Queueing…" : "Start audit"}</button></div>
    </form>
  );
}
