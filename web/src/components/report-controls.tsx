"use client";

import { useMemo, useState } from "react";
import type { Finding } from "@/lib/data/types";
import { Icon } from "./icons";

export function FindingsTable({ findings, auditId }: { findings: Finding[]; auditId: string }) {
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [taskMessage, setTaskMessage] = useState("");
  const [creatingTasks, setCreatingTasks] = useState(false);
  const visible = useMemo(() => filter === "All" ? findings : findings.filter((item) => item.severity === filter), [filter, findings]);
  function toggleFinding(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function createTasks() {
    setCreatingTasks(true);
    setTaskMessage("");
    try {
      const response = await fetch(`/api/audits/${auditId}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingIds: [...selected] }),
      });
      const body = (await response.json()) as { created?: number; error?: string };
      if (!response.ok) {
        setTaskMessage(body.error ?? "Tasks could not be created.");
        return;
      }
      setTaskMessage(`${body.created ?? 0} finding${body.created === 1 ? "" : "s"} added to task review.`);
      setSelected(new Set());
    } catch {
      setTaskMessage("Tasks could not be created.");
    } finally {
      setCreatingTasks(false);
    }
  }
  return (
    <>
      <div className="filterbar" aria-label="Filter findings">
        {["All", "Critical", "High", "Medium", "Low", "Info"].map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}<span>{value === "All" ? findings.length : findings.filter((f) => f.severity === value).length}</span></button>)}
        <button className="task-selection-button" onClick={createTasks} disabled={!selected.size || creatingTasks}>{creatingTasks ? "Creating…" : `Create tasks (${selected.size})`}</button>
      </div>
      {taskMessage && <p className="inline-message finding-message" role="status">{taskMessage}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th><span className="sr-only">Select</span></th><th>Finding</th><th>Severity</th><th>Occurrences</th><th>Example URLs</th></tr></thead>
          <tbody>{visible.map((item) => <tr key={item.id}>
            <td><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleFinding(item.id)} aria-label={`Select ${item.title} for task creation`} /></td>
            <td><strong>{item.title}</strong><small>{item.category}</small></td>
            <td><span className={`severity severity-${item.severity.toLowerCase()}`}>{item.severity}</span></td>
            <td>{item.occurrences}</td>
            <td className="url-cell">{item.pageUrl ? <a href={item.pageUrl} target="_blank" rel="noreferrer">{item.pageUrl.replace("https://", "")}<Icon name="external"/></a> : <span>Not reported</span>}{item.resourceUrl && <a href={item.resourceUrl} target="_blank" rel="noreferrer">{item.resourceUrl.replace("https://", "")}<Icon name="external"/></a>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

export function ReportActions({ auditId }: { auditId: string }) {
  const [message, setMessage] = useState("");
  const [share, setShare] = useState<{ shareUrl: string; pin: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  async function publish() {
    setPublishing(true);
    setMessage("");
    try {
      const response = await fetch(`/api/audits/${auditId}/publish`, { method: "POST" });
      const body = (await response.json()) as { shareUrl?: string; pin?: string; error?: string };
      if (!response.ok || !body.shareUrl || !body.pin) {
        setMessage(body.error ?? "The report could not be published.");
        return;
      }
      setShare({ shareUrl: body.shareUrl, pin: body.pin });
      setMessage("Share link created. Copy the link and PIN now; the PIN cannot be recovered later.");
    } catch {
      setMessage("The report could not be published.");
    } finally {
      setPublishing(false);
    }
  }
  return <div><div className="action-row"><button className="button secondary" onClick={() => window.print()}><Icon name="download"/>Export PDF</button><button className="button secondary" onClick={() => window.location.assign(`/api/audits/${auditId}/export/csv`)}>Export CSV</button><button className="button primary" onClick={publish} disabled={publishing}>{publishing ? "Publishing…" : "Publish report"}</button></div>{message && <p className="inline-message" role="status">{message}</p>}{share && <div className="share-credentials" role="status"><a href={share.shareUrl} target="_blank" rel="noreferrer">{share.shareUrl}</a><strong>PIN: {share.pin}</strong></div>}</div>;
}
