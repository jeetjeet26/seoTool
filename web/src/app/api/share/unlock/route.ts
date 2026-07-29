import { NextResponse } from "next/server";

import { isShareBackendConfigured } from "@/lib/config";
import {
  createPortalSession,
  loadPortal,
  PORTAL_SESSION_MAX_AGE_SECONDS,
  validateTokenAndPin,
} from "@/lib/share/server";

export async function POST(request: Request) {
  let body: { token?: unknown; pin?: unknown };
  try {
    body = (await request.json()) as { token?: unknown; pin?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!token || token.length > 512 || pin.length < 4 || pin.length > 128) {
    return NextResponse.json(
      { error: "The link or PIN is invalid." },
      { status: 400 },
    );
  }

  if (!isShareBackendConfigured) {
    return NextResponse.json(
      { error: "Client portal access is not configured." },
      { status: 503 },
    );
  }

  const auditId = await validateTokenAndPin(token, pin);
  if (!auditId) {
    return NextResponse.json(
      { error: "The link or PIN is invalid, expired, or temporarily locked." },
      { status: 401 },
    );
  }
  const portal = await loadPortal(auditId);
  if (!portal) {
    return NextResponse.json(
      { error: "This report is not currently published." },
      { status: 404 },
    );
  }

  const response = NextResponse.json({ portal });
  response.cookies.set("seo_portal_session", createPortalSession(auditId, token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: PORTAL_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
