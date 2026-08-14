"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { queueAudit, type QueueAuditState } from "@/actions/audits";
import { uploadCrawlFiles } from "@/lib/crawl-import-client";

const initialState: QueueAuditState = {};

export function AuditForm() {
  const [state, action, pending] = useActionState(queueAudit, initialState);
  const [crawlSource, setCrawlSource] = useState("cloud");
  const [communityType, setCommunityType] = useState("multifamily");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const processedAudit = useRef("");

  useEffect(() => {
    if (
      !state.auditId
      || !state.uploadMode
      || !files.length
      || processedAudit.current === state.auditId
    ) return;
    processedAudit.current = state.auditId;
    setUploading(true);
    uploadCrawlFiles(state.auditId, files, state.uploadMode, setUploadMessage)
      .then(() => {
        window.location.assign(`/audits/${state.auditId}`);
      })
      .catch((error) => {
        processedAudit.current = "";
        setUploadMessage(
          error instanceof Error ? error.message : "The crawl upload failed.",
        );
      })
      .finally(() => setUploading(false));
  }, [files, state.auditId, state.uploadMode]);

  return (
    <form className="form-card" action={action}>
      <input type="hidden" name="hasLocalUpload" value={files.length ? "yes" : "no"} />
      {state.message && <div className="notice success" role="status"><strong>{state.auditId ? "Audit created." : "Audit queued."}</strong><span>{state.message}</span></div>}
      {state.error && <div className="notice" role="alert"><strong>Unable to queue audit.</strong><span>{state.error}</span></div>}
      {uploadMessage && <div className="notice success" role="status"><strong>Local crawl upload</strong><span>{uploadMessage}</span></div>}
      <div className="form-section">
        <div><span className="step-number">1</span><h2>Target</h2><p>Enter the client and starting URL.</p></div>
        <div className="fields">
          <label>Client name<input name="clientName" required autoComplete="organization" placeholder="Client or property name" /></label>
          <label>Website URL<input name="targetUrl" type="url" required placeholder="https://example.com" /></label>
          <div className="field-row"><label>Primary city<input name="targetCity" required placeholder="Walnut" /></label><label>State or region<input name="targetRegion" placeholder="California" maxLength={160} /></label></div>
          <label>Metro or secondary market <span className="label-hint">Optional</span><input name="secondaryMarket" placeholder="Los Angeles" maxLength={160} /></label>
          <label>
            Community type
            <select name="communityType" value={communityType} onChange={(event) => setCommunityType(event.target.value)}>
              <option value="multifamily">Multifamily</option>
              <option value="senior_living">Senior Living</option>
              <option value="new_homes">New Homes</option>
              <option value="master_planned">Master Planned Communities</option>
              <option value="luxury_living">Luxury Living</option>
            </select>
            <small>{COMMUNITY_TYPE_DESCRIPTIONS[communityType]}</small>
          </label>
          <label>
            Competitors <span className="label-hint">Optional · community name or domain · one per line · maximum 10</span>
            <textarea
              name="competitors"
              rows={4}
              maxLength={2000}
              placeholder={"Sella by Lennar\ncompetitor-two.com"}
            />
            <small>Community names are verified with Google Places. Domains and full URLs are also accepted.</small>
          </label>
        </div>
      </div>
      <div className="form-section">
        <div><span className="step-number">2</span><h2>Report settings</h2><p>Choose the P11 deliverable and crawl depth.</p></div>
        <div className="fields">
          <label>
            Crawl source
            <select name="crawlSource" value={crawlSource} onChange={(event) => {
              setCrawlSource(event.target.value);
              if (event.target.value === "cloud") setFiles([]);
            }}>
              <option value="cloud">Cloud Screaming Frog crawl</option>
              <option value="local">Upload local Screaming Frog crawl instead</option>
              <option value="cloud_fallback">Cloud crawl with optional local fallback</option>
            </select>
          </label>
          {crawlSource !== "cloud" && <label>
            Screaming Frog exports <span className="label-hint">{crawlSource === "local" ? "Required" : "Optional fallback"} · one ZIP or individual CSV files</span>
            <input
              type="file"
              accept=".zip,.csv,text/csv,application/zip"
              multiple
              disabled={pending || uploading}
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            {files.length > 0 && <small>{files.length} file{files.length === 1 ? "" : "s"} selected</small>}
          </label>}
          <label>
            Report variant
            <select name="reportVariant" defaultValue="full_client">
              <option value="full_client">Full client report (7 sections)</option>
              <option value="in_house">In-house corporate SEO Treatment (3 sections)</option>
            </select>
          </label>
          <label>Page limit <span className="label-hint">Maximum 1,000</span><input name="pageLimit" type="number" min="1" max="1000" defaultValue="250" required /></label>
          <details>
            <summary>Optional PageSpeed and accessibility checks</summary>
            <div className="fields">
              <label className="toggle-row"><span><strong>Performance checks</strong><small>Collect sampled mobile PageSpeed signals.</small></span><input name="runPerformance" type="checkbox" /></label>
              <label className="toggle-row"><span><strong>Accessibility checks</strong><small>Collect sampled automated accessibility signals.</small></span><input name="runAccessibility" type="checkbox" /></label>
            </div>
          </details>
        </div>
      </div>
      <div className="form-actions"><a className="button secondary" href="/dashboard">Cancel</a><button className="button primary" type="submit" disabled={pending || uploading}>{pending ? "Creating…" : uploading ? "Uploading…" : "Start audit"}</button></div>
    </form>
  );
}

const COMMUNITY_TYPE_DESCRIPTIONS: Record<string, string> = {
  multifamily: "Drive demand and lease-ups for modern multifamily communities.",
  senior_living: "Build trust-first messaging that resonates with residents and families.",
  new_homes: "Launch new communities with clarity, momentum, and buyer confidence.",
  master_planned: "Master planned communities aren't a single campaign - they're a story in motion.",
  luxury_living: "Position elevated communities with refined, experience-led messaging.",
};
