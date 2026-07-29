import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isShareBackendConfigured } from "@/lib/config";
import {
  updatePortalFindings,
  verifyPortalSession,
} from "@/lib/share/server";

const STATUSES = new Set(["open", "resolved"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!isShareBackendConfigured) {
    return NextResponse.json({ error: "Client portal access is not configured." }, { status: 503 });
  }

  const { token } = await params;
  const cookieStore = await cookies();
  const session = verifyPortalSession(
    cookieStore.get("seo_portal_session")?.value,
    token,
  );
  if (!session) {
    return NextResponse.json({ error: "The client portal session expired." }, { status: 401 });
  }

  let findingIds: string[] = [];
  let status = "";
  try {
    const body = (await request.json()) as {
      findingIds?: unknown;
      status?: unknown;
    };
    if (Array.isArray(body.findingIds)) {
      findingIds = [...new Set(body.findingIds.filter(
        (value): value is string => typeof value === "string" && UUID_PATTERN.test(value),
      ))];
    }
    if (typeof body.status === "string") status = body.status;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!findingIds.length || findingIds.length > 500 || !STATUSES.has(status)) {
    return NextResponse.json(
      { error: "Select valid findings and an open or resolved status." },
      { status: 400 },
    );
  }

  try {
    const updated = await updatePortalFindings(
      session.auditId,
      findingIds,
      status as "open" | "resolved",
    );
    return NextResponse.json({ updated });
  } catch {
    return NextResponse.json(
      { error: "The URL status could not be updated." },
      { status: 500 },
    );
  }
}
