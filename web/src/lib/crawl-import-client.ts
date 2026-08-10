"use client";

import { createBrowserClient } from "@supabase/ssr";

type UploadAuthorization = {
  name: string;
  size: number;
  type: string;
  path: string;
  token: string;
};

export type CrawlImportMode = "local" | "fallback";

export async function uploadCrawlFiles(
  auditId: string,
  files: File[],
  mode: CrawlImportMode,
  onProgress: (message: string) => void,
) {
  onProgress("Preparing secure upload…");
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
    onProgress(`Uploading ${index + 1} of ${uploads.length}…`);
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
  onProgress("Queueing imported crawl for analysis…");
  const finalizeResponse = await fetch(
    `/api/audits/${auditId}/crawl-import`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "finalize",
        mode,
        files: uploads,
      }),
    },
  );
  const finalized = await finalizeResponse.json();
  if (!finalizeResponse.ok) {
    throw new Error(finalized.error ?? "Import could not be queued.");
  }
}

function fileDescriptor(file: File) {
  return {
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
  };
}
