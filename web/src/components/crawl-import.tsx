"use client";

import { useState } from "react";

import { uploadCrawlFiles } from "@/lib/crawl-import-client";

export function CrawlImport({ auditId }: { auditId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function upload() {
    if (!files.length) return;
    setUploading(true);
    setMessage("Preparing secure upload…");
    try {
      await uploadCrawlFiles(auditId, files, "local", setMessage);
      setMessage("Import uploaded. The audit is queued for reprocessing.");
      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The crawl import failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  return <section className="card report-section">
    <div className="section-title">
      <div>
        <h2>Import local Screaming Frog crawl</h2>
        <p>Upload one ZIP containing the crawl CSV exports, or select the individual CSV files. Internal:All is required.</p>
      </div>
    </div>
    <div className="crawl-import">
      <input
        type="file"
        accept=".zip,.csv,text/csv,application/zip"
        multiple
        disabled={uploading}
        onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
      />
      <button
        className="button primary"
        type="button"
        disabled={!files.length || uploading}
        onClick={upload}
      >
        {uploading ? "Uploading…" : "Upload and reprocess"}
      </button>
      {files.length > 0 && <small>{files.length} file{files.length === 1 ? "" : "s"} selected</small>}
      {message && <p className="inline-message" role="status">{message}</p>}
    </div>
  </section>;
}
