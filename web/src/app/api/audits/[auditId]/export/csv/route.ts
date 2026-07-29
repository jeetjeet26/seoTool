import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const rows = await loadRows(auditId);

  if (!rows) {
    return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  }

  const headers = [
    "Severity",
    "Category",
    "Finding",
    "Page URL",
    "Resource URL",
    "Recommendation",
  ];
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.severity,
        row.category,
        row.title,
        row.page_url,
        row.resource_url,
        row.recommendation,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="seo-audit-${auditId}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}

async function loadRows(auditId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("findings")
    .select(
      "severity,category,title,page_url,resource_url,recommendation",
    )
    .eq("audit_id", auditId)
    .order("severity");
  if (error) return null;
  return data;
}
