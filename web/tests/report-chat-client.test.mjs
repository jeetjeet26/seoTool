import test from "node:test";
import assert from "node:assert/strict";
import { readReportChatResponse, reportChatErrorMessage, ReportChatResponseError } from "../src/lib/report-chat/client.ts";

test("JSON chat responses remain usable", async () => {
  const entry = { id: "saved-entry", changes: [], message: "Saved" };
  assert.deepEqual(await readReportChatResponse(Response.json(entry), "submit"), entry);
});

test("HTML gateway timeout keeps a retryable outcome and draft guidance", async () => {
  await assert.rejects(readReportChatResponse(new Response("<html>Gateway timeout</html>", { status: 504 }), "submit"), (error) => {
    assert.ok(error instanceof ReportChatResponseError);
    assert.equal(error.retryable, true);
    assert.match(error.message, /timed out/);
    assert.match(error.message, /draft is preserved/);
    assert.match(error.message, /retry safely/);
    assert.doesNotMatch(error.message, /Unexpected token|<html>|Nothing was saved/);
    return true;
  });
});

test("structured validation errors retain their explanation and allow a fresh request", async () => {
  await assert.rejects(readReportChatResponse(Response.json({ error: "The report changed. Please try again." }, { status: 409 }), "submit"), (error) => {
    assert.equal(error.retryable, false);
    assert.match(error.message, /The report changed/);
    return true;
  });
});

test("malformed successful responses retain request identity because a save may have happened", async () => {
  for (const body of ["", "<html>Service unavailable</html>", "null", "[]", "{}", '{"error":"Proxy error"}']) {
    await assert.rejects(readReportChatResponse(new Response(body), "submit"), (error) => error.retryable && /draft is preserved/.test(error.message));
  }
});

test("transient JSON errors are retryable and preserve their message", async () => {
  for (const status of [408, 429, 500, 503]) {
    await assert.rejects(readReportChatResponse(Response.json({ error: "Please wait for the current edit." }, { status }), "submit"), (error) => error.retryable && /Please wait for the current edit/.test(error.message));
  }
});

test("history and undo failures have action-specific recovery steps", async () => {
  await assert.rejects(readReportChatResponse(new Response("Bad gateway", { status: 502 }), "history"), /Close and reopen the editor to retry/);
  await assert.rejects(readReportChatResponse(new Response("Bad gateway", { status: 502 }), "undo"), /check the edit's status before trying Undo again/);
  assert.match(reportChatErrorMessage(new TypeError("Failed to fetch"), "submit"), /Check your connection.*draft is preserved/);
  assert.doesNotMatch(reportChatErrorMessage(new TypeError("Failed to fetch"), "undo"), /draft/);
});
