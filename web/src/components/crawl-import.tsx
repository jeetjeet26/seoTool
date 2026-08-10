"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";

type UploadAuthorization = {
  name: string;
  size: number;
  type: string;
  path: string;
  token: string;
};

export function CrawlImport({ auditId }: { auditId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function upload() {
    if (!files.length) return;
    setUploading(true);
    setMessage("Preparing secure upload…");
    try {
      const authorizationResponse = await fetch(
        `/api/audits/${auditId}/crawl-import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "create",
            files: files.map(fileDescriptor),
          }),
        },
      );
      const authorization = await authorizationResponse.json();
      if (!authorizationResponse.ok) {
        throw new Error(authorization.error ?? "Upload could not be prepared.");
      }
      const uploads = authorization.uploads as UploadAuthorization[];
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      );
      for (let index = 0; index < uploads.length; index += 1) {
        setMessage(`Uploading ${index + 1} of ${uploads.length}…`);
        const upload = uploads[index];
        const file = files[index];
        if (!file) throw new Error(`Missing selected file: ${upload.name}`);
        const { error } = await supabase.storage
          .from("audit-artifacts")
          .uploadToSignedUrl(upload.path, upload.token, file, {
            contentType: upload.type,
          });
        if (error) throw error;
      }
      setMessage("Queueing imported crawl for analysis…");
      const finalizeResponse = await fetch(
        `/api/audits/${auditId}/crawl-import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "finalize",
            files: uploads,
          }),
        },
      );
      const finalized = await finalizeResponse.json();
      if (!finalizeResponse.ok) {
        throw new Error(finalized.error ?? "Import could not be queued.");
      }
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

function fileDescriptor(file: File) {
  return {
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
  };
}
