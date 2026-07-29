import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const REVIEW_STATUSES = new Set(["unreviewed", "approved", "rejected"]);
const MAX_ITEMS = 500;

interface ItemUpdate {
  id: string;
  reviewStatus?: string;
  editedOutput?: Record<string, unknown>;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  let updates: ItemUpdate[] = [];
  try {
    const body = (await request.json()) as { items?: unknown };
    if (Array.isArray(body.items)) {
      updates = body.items.filter(
        (entry): entry is ItemUpdate =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as ItemUpdate).id === "string",
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!updates.length) {
    return NextResponse.json({ updated: 0 });
  }
  if (updates.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `A maximum of ${MAX_ITEMS} items can be updated at once.` },
      { status: 400 },
    );
  }
  for (const update of updates) {
    if (update.reviewStatus && !REVIEW_STATUSES.has(update.reviewStatus)) {
      return NextResponse.json({ error: "Invalid review status." }, { status: 400 });
    }
    if (
      update.editedOutput !== undefined &&
      (typeof update.editedOutput !== "object" ||
        update.editedOutput === null ||
        Array.isArray(update.editedOutput))
    ) {
      return NextResponse.json({ error: "Invalid edited output." }, { status: 400 });
    }
    if (
      update.editedOutput &&
      JSON.stringify(update.editedOutput).length > 100_000
    ) {
      return NextResponse.json(
        { error: "Edited output is too large." },
        { status: 400 },
      );
    }
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

  let updated = 0;
  for (const update of updates) {
    const changes: Record<string, unknown> = {};
    if (update.editedOutput !== undefined) {
      changes.edited_output = update.editedOutput;
    }
    if (update.reviewStatus) {
      changes.review_status = update.reviewStatus;
      changes.reviewed_by = update.reviewStatus === "unreviewed" ? null : actorId;
      changes.reviewed_at =
        update.reviewStatus === "unreviewed" ? null : new Date().toISOString();
    }
    if (!Object.keys(changes).length) continue;

    const { error } = await supabase
      .from("tool_run_items")
      .update(changes)
      .eq("id", update.id)
      .eq("run_id", runId);
    if (error) {
      return NextResponse.json(
        { error: "The review could not be saved.", updated },
        { status: 500 },
      );
    }
    updated += 1;
  }

  await supabase.from("tool_run_events").insert({
    run_id: runId,
    event_type: "tool.review.saved",
    message: `${updated} items updated`,
    actor_id: actorId,
  });

  return NextResponse.json({ updated });
}
