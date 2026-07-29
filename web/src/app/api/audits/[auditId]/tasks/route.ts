import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  let findingIds: string[] = [];
  try {
    const body = (await request.json()) as { findingIds?: unknown };
    if (Array.isArray(body.findingIds)) {
      findingIds = body.findingIds.filter(
        (value): value is string => typeof value === "string",
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!findingIds.length || findingIds.length > 200) {
    return NextResponse.json(
      { error: "Select between 1 and 200 findings." },
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
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const actorId = claimsData?.claims?.sub;
  if (claimsError || !actorId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: findings, error: findingError } = await supabase
    .from("findings")
    .select("id,title,recommendation,severity")
    .eq("audit_id", auditId)
    .in("id", findingIds);
  if (findingError || !findings?.length) {
    return NextResponse.json(
      { error: "The selected findings could not be loaded." },
      { status: 400 },
    );
  }

  const { data: existingTasks } = await supabase
    .from("tasks")
    .select("finding_id")
    .eq("audit_id", auditId)
    .in("finding_id", findingIds);
  const existingIds = new Set(
    (existingTasks ?? []).map((task) => task.finding_id),
  );
  const newTasks = findings
    .filter((finding) => !existingIds.has(finding.id))
    .map((finding) => ({
      audit_id: auditId,
      finding_id: finding.id,
      title: finding.title,
      description: finding.recommendation,
      priority:
        finding.severity === "critical"
          ? "urgent"
          : ["high", "medium", "low"].includes(finding.severity)
            ? finding.severity
            : "low",
      created_by: actorId,
      is_client_visible: false,
    }));
  if (!newTasks.length) {
    return NextResponse.json({ created: 0 });
  }

  const { error } = await supabase.from("tasks").insert(newTasks);
  if (error) {
    return NextResponse.json(
      { error: "The review tasks could not be created." },
      { status: 500 },
    );
  }

  return NextResponse.json({ created: newTasks.length });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  let visibleTaskIds: string[] = [];
  try {
    const body = (await request.json()) as { visibleTaskIds?: unknown };
    if (Array.isArray(body.visibleTaskIds)) {
      visibleTaskIds = body.visibleTaskIds.filter(
        (value): value is string => typeof value === "string",
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (visibleTaskIds.length > 200) {
    return NextResponse.json(
      { error: "A maximum of 200 tasks can be published at once." },
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
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { error: clearError } = await supabase
    .from("tasks")
    .update({ is_client_visible: false, published_at: null })
    .eq("audit_id", auditId);
  if (clearError) {
    return NextResponse.json(
      { error: "The client task list could not be updated." },
      { status: 500 },
    );
  }
  if (visibleTaskIds.length) {
    const { error: publishError } = await supabase
      .from("tasks")
      .update({
        is_client_visible: true,
        published_at: new Date().toISOString(),
      })
      .eq("audit_id", auditId)
      .in("id", visibleTaskIds);
    if (publishError) {
      return NextResponse.json(
        { error: "The selected tasks could not be published." },
        { status: 500 },
      );
    }
  }
  return NextResponse.json({ published: visibleTaskIds.length });
}
