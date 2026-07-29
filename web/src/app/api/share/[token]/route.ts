import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isShareBackendConfigured } from "@/lib/config";
import { loadPortal, verifyPortalSession } from "@/lib/share/server";

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

  const portal = await loadPortal(session.auditId);
  if (!portal) {
    return NextResponse.json(
      { error: "This report is not currently published." },
      { status: 404 },
    );
  }
  return NextResponse.json({ portal });
}
