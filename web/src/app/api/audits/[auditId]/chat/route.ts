import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { chatState, chatUser, sendChat, undoChat } from "@/lib/report-chat/server";
import { MAX_MESSAGE_CHARACTERS } from "@/lib/report-chat/input";
import { ChatError, UUID } from "@/lib/report-chat/patch";

export const runtime = "nodejs";
export const maxDuration = 240;
type Context = { params: Promise<{ auditId: string }> };
function failure(error: unknown) {
  if (error instanceof ChatError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Report chat failed", error instanceof Error ? error.name : "Unknown error");
  return NextResponse.json({ error: "The report could not be updated. Please try again." }, { status: 500 });
}
async function target(context: Context) {
  const { auditId } = await context.params;
  if (!UUID.test(auditId)) throw new ChatError("Report not found.", 404);
  return auditId;
}
export async function GET(_request: Request, context: Context) {
  try {
    const userId = await chatUser();
    return NextResponse.json(await chatState(await target(context), userId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new ChatError("Invalid request origin.", 403);
    const userId = await chatUser();
    const auditId = await target(context);
    const raw = await request.text();
    if (raw.length > MAX_MESSAGE_CHARACTERS * 6 + 1000) throw new ChatError("Please keep your review under 100,000 characters. Nothing was saved.", 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new ChatError("Invalid request."); }
    if (!body || typeof body !== "object") throw new ChatError("Invalid request.");
    let result;
    if (body.action === "undo") {
      if (typeof body.eventId !== "string" || !UUID.test(body.eventId)) throw new ChatError("Invalid edit.");
      result = await undoChat(auditId, userId, body.eventId);
    } else {
      if (typeof body.message !== "string" || !body.message.trim() || body.message.length > MAX_MESSAGE_CHARACTERS || typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new ChatError("Enter an edit request of up to 100,000 characters.");
      result = await sendChat(auditId, userId, body.message.trim(), body.requestId);
    }
    revalidatePath(`/audits/${auditId}`);
    revalidatePath(`/audits/${auditId}/report`);
    return NextResponse.json(result);
  } catch (error) { return failure(error); }
}
