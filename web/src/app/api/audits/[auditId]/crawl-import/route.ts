import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_FILES = 50;
const MAX_FILE_SIZE = 49 * 1024 * 1024;

type UploadFile = {
  name: string;
  size: number;
  type?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !["create", "finalize"].includes(body.action)) {
    return NextResponse.json({ error: "Invalid import action." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const actorId = claims?.claims?.sub;
  if (!actorId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const { data: audit } = await supabase
    .from("audits")
    .select("id,status,options")
    .eq("id", auditId)
    .maybeSingle();
  if (!audit) {
    return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  }
  if (["queued", "running"].includes(audit.status)) {
    return NextResponse.json(
      { error: "Wait for the active audit run to finish before importing files." },
      { status: 409 },
    );
  }

  if (body.action === "create") {
    const files = validateFiles(body.files);
    if (!files) {
      return NextResponse.json(
        { error: "Choose up to 50 CSV files or one ZIP, each under 49 MB." },
        { status: 400 },
      );
    }
    const uploads = [];
    for (const file of files) {
      const name = safeName(file.name);
      const path = `${auditId}/crawl-import/${randomUUID()}-${name}`;
      const { data, error } = await supabase.storage
        .from("audit-artifacts")
        .createSignedUploadUrl(path);
      if (error || !data) {
        return NextResponse.json(
          { error: "Upload authorization could not be created." },
          { status: 500 },
        );
      }
      uploads.push({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        path,
        token: data.token,
      });
    }
    return NextResponse.json({ uploads });
  }

  const files = validateFinalizedFiles(auditId, body.files);
  if (!files) {
    return NextResponse.json({ error: "Invalid uploaded file list." }, { status: 400 });
  }
  for (const file of files) {
    const { error } = await supabase.from("artifacts").upsert(
      {
        audit_id: auditId,
        kind: "crawl-import",
        bucket_id: "audit-artifacts",
        object_path: file.path,
        content_type: file.type,
        byte_size: file.size,
        created_by: actorId,
      },
      { onConflict: "bucket_id,object_path" },
    );
    if (error) {
      return NextResponse.json(
        { error: "Uploaded files could not be registered." },
        { status: 500 },
      );
    }
  }

  await supabase.from("findings").delete().eq("audit_id", auditId);
  const mode = body.mode === "fallback" ? "fallback" : "local";
  const importOptions = { ...(audit.options ?? {}) };
  delete importOptions.crawl_import_paths;
  delete importOptions.crawl_fallback_paths;
  importOptions[
    mode === "fallback" ? "crawl_fallback_paths" : "crawl_import_paths"
  ] = files.map((file) => file.path);
  const { error: queueError } = await supabase
    .from("audits")
    .update({
      status: "queued",
      current_stage: "queued",
      progress: 0,
      failure_message: null,
      completed_at: null,
      options: importOptions,
    })
    .eq("id", auditId);
  if (queueError) {
    return NextResponse.json(
      { error: "The audit could not be queued for import." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, queued: true });
}

function validateFiles(value: unknown): UploadFile[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_FILES) return null;
  const files = value.map((item) => ({
    name: String(item?.name ?? ""),
    size: Number(item?.size ?? 0),
    type: String(item?.type ?? ""),
  }));
  if (
    files.some(
      (file) =>
        !isSupported(file.name)
        || !Number.isFinite(file.size)
        || file.size <= 0
        || file.size > MAX_FILE_SIZE,
    )
  ) return null;
  if (files.some((file) => file.name.toLowerCase().endsWith(".zip")) && files.length !== 1) {
    return null;
  }
  return files;
}

function validateFinalizedFiles(
  auditId: string,
  value: unknown,
): Array<UploadFile & { path: string }> | null {
  const files = validateFiles(value);
  if (!files) return null;
  const finalized = files.map((file, index) => ({
    ...file,
    path: String((value as Array<{ path?: string }>)[index]?.path ?? ""),
  }));
  return finalized.every(
    (file) =>
      file.path.startsWith(`${auditId}/crawl-import/`)
      && isSupported(file.path),
  )
    ? finalized
    : null;
}

function isSupported(name: string) {
  const lowered = name.toLowerCase();
  return lowered.endsWith(".csv") || lowered.endsWith(".zip");
}

function safeName(value: string) {
  const name = value.split(/[\\/]/).at(-1) ?? "crawl-export.csv";
  return name.replace(/[^a-zA-Z0-9._()-]+/g, "-").slice(-180);
}
