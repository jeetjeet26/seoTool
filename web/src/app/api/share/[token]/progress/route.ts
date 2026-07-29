import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isShareBackendConfigured } from "@/lib/config";
import {
  createPortalSession,
  loadPortalProgress,
  PORTAL_SESSION_MAX_AGE_SECONDS,
  verifyPortalSession,
} from "@/lib/share/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!isShareBackendConfigured) {
    return NextResponse.json({ error: "No active session." }, { status: 401 });
  }

  const { token } = await params;
  const cookieStore = await cookies();
  const session = verifyPortalSession(
    cookieStore.get("seo_portal_session")?.value,
    token,
  );
  if (!session) {
    return NextResponse.json(
      { error: "The client portal session expired." },
      { status: 401 },
    );
  }

  try {
    const progress = await loadPortalProgress(session.auditId);
    const response = NextResponse.json(
      { progress },
      { headers: { "Cache-Control": "private, no-store" } },
    );
    response.cookies.set(
      "seo_portal_session",
      createPortalSession(session.auditId, token),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: PORTAL_SESSION_MAX_AGE_SECONDS,
        path: "/",
      },
    );
    return response;
  } catch {
    return NextResponse.json(
      { error: "Report progress is temporarily unavailable." },
      { status: 500 },
    );
  }
}
