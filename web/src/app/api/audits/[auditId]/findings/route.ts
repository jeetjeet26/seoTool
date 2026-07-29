import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const EDITABLE_STATUSES = new Set(["open", "resolved"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  let findingIds: string[] = [];
  let status = "";

  try {
    const body = (await request.json()) as {
      findingIds?: unknown;
      status?: unknown;
    };
    if (Array.isArray(body.findingIds)) {
      findingIds = [...new Set(body.findingIds.filter(
        (value): value is string => typeof value === "string",
      ))];
    }
    if (typeof body.status === "string") status = body.status;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!findingIds.length || findingIds.length > 500 || !EDITABLE_STATUSES.has(status)) {
    return NextResponse.json(
      { error: "Select valid findings and an open or resolved status." },
      { status: 400 },
    );
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("findings")
    .update({
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    })
    .eq("audit_id", auditId)
    .in("id", findingIds)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: "The finding status could not be updated." },
      { status: 500 },
    );
  }

  return NextResponse.json({ updated: data?.length ?? 0 });
}
