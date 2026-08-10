import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !["approve", "retire"].includes(body.action)) {
    return NextResponse.json({ error: "Invalid target action." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const actorId = claims?.claims?.sub;
  if (!actorId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const { data: audit } = await supabase
    .from("audits")
    .select("client_id")
    .eq("id", auditId)
    .maybeSingle();
  if (!audit) {
    return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  }

  if (body.action === "retire") {
    const targetId = String(body.targetId ?? "");
    const { data: previous, error: lookupError } = await supabase
      .from("keyword_targets")
      .select("*")
      .eq("id", targetId)
      .eq("client_id", audit.client_id)
      .maybeSingle();
    if (lookupError || !previous) {
      return NextResponse.json({ error: "Target not found." }, { status: 404 });
    }
    const { error } = await supabase
      .from("keyword_targets")
      .update({ status: "retired" })
      .eq("id", targetId);
    if (error) {
      return NextResponse.json({ error: "Target could not be retired." }, { status: 500 });
    }
    await supabase.from("keyword_target_events").insert({
      target_id: targetId,
      event_type: "retired",
      previous_value: previous,
      next_value: { ...previous, status: "retired" },
      actor_id: actorId,
      reason: String(body.reason ?? "Manual target change"),
    });
    return NextResponse.json({ ok: true });
  }

  const keyword = String(body.keyword ?? "").trim();
  const canonicalUrl = normalizeUrl(String(body.canonicalUrl ?? ""));
  const role = body.role === "secondary" ? "secondary" : "primary";
  if (!keyword || !canonicalUrl) {
    return NextResponse.json(
      { error: "Keyword and target page are required." },
      { status: 400 },
    );
  }

  if (role === "primary") {
    await supabase
      .from("keyword_targets")
      .update({ status: "retired" })
      .eq("client_id", audit.client_id)
      .eq("canonical_url", canonicalUrl)
      .eq("role", "primary")
      .eq("status", "approved");
  }
  await supabase
    .from("keyword_targets")
    .update({ status: "retired" })
    .eq("client_id", audit.client_id)
    .ilike("keyword", keyword)
    .eq("status", "approved");

  const { data: target, error } = await supabase
    .from("keyword_targets")
    .insert({
      client_id: audit.client_id,
      keyword,
      canonical_url: canonicalUrl,
      role,
      status: "approved",
      metrics: body.metrics ?? {},
      source: "audit_review",
      rationale: String(body.rationale ?? ""),
      approved_by: actorId,
      approved_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !target) {
    return NextResponse.json(
      { error: error?.message ?? "Target could not be approved." },
      { status: 500 },
    );
  }
  await supabase.from("keyword_target_events").insert({
    target_id: target.id,
    event_type: "approved",
    next_value: target,
    actor_id: actorId,
    reason: String(body.reason ?? "Approved from audit report"),
  });
  return NextResponse.json({ ok: true, target });
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}
