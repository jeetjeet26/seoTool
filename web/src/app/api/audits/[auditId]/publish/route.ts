import { randomBytes, randomInt } from "node:crypto";

import { NextResponse } from "next/server";

import { isShareBackendConfigured, isSupabaseConfigured } from "@/lib/config";
import { createShareLink } from "@/lib/share/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await params;
  const token = randomBytes(32).toString("base64url");
  const pin = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const shareUrl = new URL(`/share/${token}`, request.url).toString();

  if (!isSupabaseConfigured || !isShareBackendConfigured) {
    return NextResponse.json(
      { error: "Report sharing is not configured." },
      { status: 503 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const actorId = data?.claims?.sub;
  if (error || !actorId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    await createShareLink(auditId, token, pin, expiresAt, actorId);
  } catch {
    return NextResponse.json(
      { error: "Only an administrator can publish completed reports." },
      { status: 403 },
    );
  }

  return NextResponse.json({
    shareUrl,
    pin,
    expiresAt: expiresAt.toISOString(),
  });
}
