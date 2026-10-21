"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_REVIEW_CHARACTERS, reviewMessage } from "@/lib/report-chat/input";
import { readReportChatResponse, reportChatErrorMessage, ReportChatResponseError } from "@/lib/report-chat/client";
import type { ChatEntry } from "@/lib/report-chat/server";

type ChatState = { entries: ChatEntry[]; configured: boolean; exportState: string };

export function ReportChat({ auditId, reportName, reportUrl }: { auditId: string; reportName: string; reportUrl: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [selection, setSelection] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [exportState, setExportState] = useState("ready");
  const retry = useRef<{ message: string; requestId: string } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const endpoint = `/api/audits/${auditId}/chat`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      const result = await readReportChatResponse<ChatState>(response, "history");
      setEntries(result.entries); setConfigured(result.configured); setExportState(result.exportState); setError("");
    }).catch((reason) => { if (!controller.signal.aborted) setError(reportChatErrorMessage(reason, "history")); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    input.current?.focus();
    return () => controller.abort();
  }, [open, endpoint]);
  useEffect(() => {
    const capture = () => {
      const selected = window.getSelection();
      if (selected?.anchorNode?.parentElement?.closest(".report-chat")) return;
      const value = selected?.toString().trim() ?? "";
      if (value) setSelection(value.slice(0, 2000));
    };
    document.addEventListener("mouseup", capture);
    return () => document.removeEventListener("mouseup", capture);
  }, []);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [entries, pendingPrompt, error]);
  useEffect(() => {
    if (!open || exportState !== "pending") return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(endpoint);
        if (!response.ok) return;
        const result = await readReportChatResponse<ChatState>(response, "history");
        setExportState(result.exportState);
        if (result.exportState === "ready") router.refresh();
      } catch { /* Keep the saved edit visible while the network recovers. */ }
    }, 8000);
    return () => clearInterval(timer);
  }, [endpoint, exportState, open, router]);

  async function submit() {
    if (!draft.trim() || busy) return;
    let message: string;
    try { message = reviewMessage(draft, selection); }
    catch (reason) { setError((reason as Error).message); return; }
    const request = retry.current?.message === message ? retry.current : { message, requestId: crypto.randomUUID() };
    retry.current = request;
    setBusy(true); setError(""); setPendingPrompt(draft.trim());
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const result = await readReportChatResponse<ChatEntry>(response, "submit");
      setEntries((current) => current.some((item) => item.id === result.id) ? current : [...current, result]);
      setDraft(""); setSelection(""); retry.current = null;
      if (result.changes.length) { setExportState("pending"); router.refresh(); }
    } catch (reason) {
      if (reason instanceof ReportChatResponseError && !reason.retryable) retry.current = null;
      setError(reportChatErrorMessage(reason, "submit"));
    }
    finally { setBusy(false); setPendingPrompt(""); input.current?.focus(); }
  }
  async function importReview(file: File) {
    setBusy(true);
    try {
      if (!/\.(md|txt)$/i.test(file.name)) throw new Error("Choose a Markdown (.md) or text (.txt) review.");
      if (file.size > MAX_REVIEW_CHARACTERS * 4) throw new Error("This file is too large. Use a review under 100,000 characters.");
      const text = await file.text();
      const combined = [draft, text].filter(Boolean).join("\n\n");
      reviewMessage(combined);
      setDraft(combined); setError(""); input.current?.focus();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function undo(eventId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "undo", eventId }) });
      await readReportChatResponse(response, "undo");
      setEntries((current) => current.map((item) => item.id === eventId ? { ...item, undoable: false } : item));
      setExportState("pending"); router.refresh();
    } catch (reason) { setError(reportChatErrorMessage(reason, "undo")); }
    finally { setBusy(false); }
  }
  return <aside className={`report-chat${open ? " is-open" : ""}`} aria-label="Report editing assistant">
    {!open ? <button className="report-chat-launch" onClick={() => setOpen(true)} aria-expanded={false} aria-controls="report-chat-panel"><span aria-hidden="true">✦</span><span>Edit report with AI<small>Target: {reportName}</small></span></button> : <section id="report-chat-panel" className="report-chat-panel">
      <header className="report-chat-header"><div><strong>Report editor</strong><small>GPT-5.6 Terra</small></div><button onClick={() => setOpen(false)} aria-label="Minimize report editor">−</button></header>
      <div className="report-chat-target"><span className="report-chat-dot"/><div><small>Targeting this report only</small><strong>{reportName}</strong><span>{reportUrl}</span><small>Report {auditId.slice(0, 8)}</small></div></div>
      <div className="report-chat-log" ref={log} role="log" aria-live="polite" aria-relevant="additions text">
        {loading ? <p>Loading conversation…</p> : <>
          {!entries.length && <div className="report-chat-welcome"><strong>What would you like to change?</strong><p>Paste or attach a review to edit keywords, titles, descriptions, content, or technical findings in this saved report. Include verified facts and measurements you want applied. Highlight text in the report to include it with your request.</p><div className="report-chat-examples">{["Replace a keyword…", "Change the alt text for…", "Rewrite the executive summary…"].map((example) => <button key={example} onClick={() => { setDraft(example.replace("…", " ")); input.current?.focus(); }}>{example}</button>)}</div><small>Specific requests are saved directly to this report. Every change can be reviewed below and undone.</small></div>}
          {entries.map((item) => <div key={item.id} className="report-chat-turn"><div className="report-chat-user">{item.prompt}</div><div className="report-chat-assistant"><p>{item.message}</p>{!!item.pending?.length && <div><strong>Still pending</strong><ul>{item.pending.map((task, index) => <li key={index}>{task}</li>)}</ul></div>}{item.changes.length === 0 && <small>No report changes saved.</small>}{item.changes.length > 0 && <><details><summary>{item.changes.length} change{item.changes.length === 1 ? "" : "s"} · {item.undoable ? "Saved" : "Undone"}</summary>{item.changes.map((change, index) => <div className="report-chat-change" key={index}><small>{change.path.replace(/^\/summary\//, "").replaceAll("/", " › ").replaceAll("_", " ")}</small><del>{display(change.before)}</del><ins>{display(change.after)}</ins></div>)}</details>{item.undoable && <button className="report-chat-undo" disabled={busy} onClick={() => undo(item.id)}>Undo this edit</button>}</>}</div></div>)}
        </>}
        {pendingPrompt && <div className="report-chat-turn"><div className="report-chat-user">{pendingPrompt}</div><p className="report-chat-thinking">Reading this report and preparing your edit…</p></div>}
      </div>
      {exportState === "pending" && <p className="report-chat-export" role="status">Report saved. Updated Excel files are being prepared.</p>}
      {exportState === "failed" && <p className="report-chat-export" role="status">Report saved. Excel regeneration needs attention; the on-screen report and live CSV are current.</p>}
      {error && <p className="report-chat-error" role="alert">{error}</p>}
      {!configured && <p className="report-chat-error">Add OPENAI_API_KEY to the server configuration to enable chat.</p>}
      <form className="report-chat-compose" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <small id="report-chat-capabilities">Edits this saved report. Live website checks and Semrush research are unavailable here; paste verified facts or metrics to apply them.</small>
        {selection && <div className="report-chat-selection"><span>Selected: {selection}</span><button type="button" aria-label="Remove selected text" onClick={() => setSelection("")}>×</button></div>}
        <label className="sr-only" htmlFor="report-chat-message">Describe your report edit</label>
        <textarea id="report-chat-message" aria-describedby="report-chat-capabilities" ref={input} value={draft} disabled={busy || !configured} placeholder="Paste your review findings and describe the changes to apply…" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}/>
        <input ref={fileInput} type="file" accept=".md,.txt,text/markdown,text/plain" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importReview(file); }}/>
        <div><button type="button" disabled={busy || loading || !configured} onClick={() => fileInput.current?.click()}>Attach review (.md / .txt)</button><small>{draft.length.toLocaleString()} / 100,000 characters</small></div>
        <div><small>Enter to send · Shift+Enter for a new line</small><button className="button primary" disabled={busy || loading || !configured || !draft.trim() || draft.length > MAX_REVIEW_CHARACTERS}>{busy ? "Working…" : "Send edit"}</button></div>
      </form>
    </section>}
  </aside>;
}
function display(value: unknown) {
  if (value === null) return "(removed / not present)";
  return typeof value === "string" ? value || "(empty)" : JSON.stringify(value, null, 2);
}
