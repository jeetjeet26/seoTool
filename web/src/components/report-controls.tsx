"use client";

import { useMemo, useState } from "react";
import type { Finding } from "@/lib/data/types";
import { Icon } from "./icons";
import { AnalystReviewNotes, FindingInstances } from "./finding-instances";
import { groupFindings, type FindingInstance as UrlOccurrence } from "@/lib/finding-groups";

export function FindingsTable({ findings, auditId }: { findings: Finding[]; auditId: string }) {
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [taskMessage, setTaskMessage] = useState("");
  const [creatingTasks, setCreatingTasks] = useState(false);
  const [statusById, setStatusById] = useState<Map<string, Finding["status"]>>(
    () => new Map(findings.map((finding) => [finding.id, finding.status])),
  );
  const [updatingUrls, setUpdatingUrls] = useState<Set<string>>(() => new Set());
  const allGroups = useMemo(() => groupFindings(findings, statusById), [findings, statusById]);
  const groups = allGroups.filter(group => group.kind !== "note");
  const notes = allGroups.filter(group => group.kind === "note");
  const visible = filter === "All" ? groups : groups.filter(item => item.severity === filter);
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
  async function toggleUrl(groupKey: string, occurrence: UrlOccurrence) {
    const pendingKey = `${groupKey}:${occurrence.key}`;
    const nextStatus: Finding["status"] = occurrence.resolved ? "open" : "resolved";
    const previousStatuses = new Map(statusById);
    setUpdatingUrls((current) => new Set(current).add(pendingKey));
    setStatusById((current) => {
      const next = new Map(current);
      occurrence.findingIds.forEach((id) => next.set(id, nextStatus));
      return next;
    });
    setTaskMessage("");
    try {
      const response = await fetch(`/api/audits/${auditId}/findings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          findingIds: occurrence.findingIds,
          status: nextStatus,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatusById(previousStatuses);
        setTaskMessage(body.error ?? "The URL status could not be updated.");
      }
    } catch {
      setStatusById(previousStatuses);
      setTaskMessage("The URL status could not be updated.");
    } finally {
      setUpdatingUrls((current) => {
        const next = new Set(current);
        next.delete(pendingKey);
        return next;
      });
    }
  }
  return (
    <>
      <section className="card report-section">
      <div className="section-title"><div><h2>Prioritized findings</h2><p>Open an issue for a short description and its affected pages, files, or links.</p></div></div>
      <div className="filterbar" aria-label="Filter findings">
        {["All", "Critical", "High", "Medium", "Low", "Info"].map((value) => {
          const matchingGroups = value === "All"
            ? groups
            : groups.filter((group) => group.severity === value);
          const occurrenceCount = matchingGroups.reduce(
            (total, group) => total + group.occurrences,
            0,
          );
          return <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}<span>{occurrenceCount}</span></button>;
        })}
        <button className="task-selection-button" onClick={createTasks} disabled={!selected.size || creatingTasks}>{creatingTasks ? "Creating…" : `Create tasks (${selected.size})`}</button>
      </div>
      {taskMessage && <p className="inline-message finding-message" role="status">{taskMessage}</p>}
      <div className="table-wrap">
        <table className="finding-table">
          <thead><tr><th><span className="sr-only">Select</span></th><th>Finding</th><th>Severity</th><th>Occurrences</th><th>Affected URLs</th></tr></thead>
          <tbody>{visible.map((item) => <tr key={item.id}>
            <td><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleFinding(item.id)} aria-label={`Select ${item.title} for task creation`} /></td>
            <td><strong>{item.title}</strong><small>{item.category}</small></td>
            <td><span className={`severity severity-${item.severity.toLowerCase()}`}>{item.severity}</span></td>
            <td>{item.occurrences}</td>
            <td className="url-cell">
              <FindingInstances group={item} updatingKeys={updatingUrls} onToggle={instance => toggleUrl(item.key, instance)}/>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      </section>
      <AnalystReviewNotes groups={notes} updatingKeys={updatingUrls} onToggle={(group, instance) => toggleUrl(group.key, instance)}/>
    </>
  );
}

export function ReportActions({ auditId, published: initialPublished = false }: { auditId: string; published?: boolean }) {
  const [message, setMessage] = useState("");
  const [share, setShare] = useState<{ shareUrl: string; pin: string } | null>(null);
  const [published, setPublished] = useState(initialPublished);
  const [publishing, setPublishing] = useState(false);
  async function publish() {
    setPublishing(true);
    setMessage("");
    try {
      const response = await fetch(`/api/audits/${auditId}/publish`, { method: "POST" });
      const body = (await response.json()) as { published?: boolean; reused?: boolean; shareUrl?: string | null; pin?: string | null; error?: string };
      if (!response.ok || !body.published) {
        setMessage(body.error ?? "The report could not be published.");
        return;
      }
      setPublished(true);
      if (body.shareUrl && body.pin) setShare({ shareUrl: body.shareUrl, pin: body.pin });
      setMessage(body.shareUrl
        ? "Published. This link and PIN stay the same; saved edits appear automatically."
        : "Already published. Continue using your existing shared link and PIN; saved edits appear automatically.");
    } catch {
      setMessage("The report could not be published.");
    } finally {
      setPublishing(false);
    }
  }
  return <div><div className="action-row"><button className="button secondary" onClick={() => window.print()}><Icon name="download"/>Export PDF</button><button className="button secondary" onClick={() => window.location.assign(`/api/audits/${auditId}/export/csv`)}>Export CSV</button><button className="button primary" onClick={publish} disabled={publishing}>{publishing ? "Loading…" : published ? "View share link" : "Publish report"}</button></div>{published && <p className="inline-message"><strong>Published</strong> · Saved edits update the shared report automatically.</p>}{message && <p className="inline-message" role="status">{message}</p>}{share && <div className="share-credentials" role="status"><a href={share.shareUrl} target="_blank" rel="noreferrer">{share.shareUrl}</a><strong>PIN: {share.pin}</strong></div>}</div>;
}
