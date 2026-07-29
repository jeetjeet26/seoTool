"use client";

import { useMemo, useState } from "react";
import type { Finding } from "@/lib/data/types";
import { Icon } from "./icons";

export function FindingsTable({ findings, auditId }: { findings: Finding[]; auditId: string }) {
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [taskMessage, setTaskMessage] = useState("");
  const [creatingTasks, setCreatingTasks] = useState(false);
  const [statusById, setStatusById] = useState<Map<string, Finding["status"]>>(
    () => new Map(findings.map((finding) => [finding.id, finding.status])),
  );
  const [updatingUrls, setUpdatingUrls] = useState<Set<string>>(() => new Set());
  const groups = useMemo(
    () => groupFindings(findings, statusById),
    [findings, statusById],
  );
  const visible = useMemo(
    () => filter === "All" ? groups : groups.filter((item) => item.severity === filter),
    [filter, groups],
  );
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
    const pendingKey = `${groupKey}:${occurrence.url}`;
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
      <div className="filterbar" aria-label="Filter findings">
        {["All", "Critical", "High", "Medium", "Low", "Info"].map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}<span>{value === "All" ? groups.length : groups.filter((group) => group.severity === value).length}</span></button>)}
        <button className="task-selection-button" onClick={createTasks} disabled={!selected.size || creatingTasks}>{creatingTasks ? "Creating…" : `Create tasks (${selected.size})`}</button>
      </div>
      {taskMessage && <p className="inline-message finding-message" role="status">{taskMessage}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th><span className="sr-only">Select</span></th><th>Finding</th><th>Severity</th><th>Occurrences</th><th>Affected URLs</th></tr></thead>
          <tbody>{visible.map((item) => <tr key={item.id}>
            <td><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleFinding(item.id)} aria-label={`Select ${item.title} for task creation`} /></td>
            <td><strong>{item.title}</strong><small>{item.category}</small></td>
            <td><span className={`severity severity-${item.severity.toLowerCase()}`}>{item.severity}</span></td>
            <td>{item.occurrences}</td>
            <td className="url-cell">
              <details>
                <summary>{item.resolvedCount}/{item.occurrences} fixed · View affected URLs</summary>
                <div className="finding-url-list">
                  {item.urls.map((occurrence) => {
                    const pendingKey = `${item.key}:${occurrence.url}`;
                    return <div key={occurrence.key} className={`finding-url-item${occurrence.resolved ? " resolved" : ""}`}>
                      <input
                        type="checkbox"
                        checked={occurrence.resolved}
                        disabled={updatingUrls.has(pendingKey)}
                        onChange={() => toggleUrl(item.key, occurrence)}
                        aria-label={`Mark ${occurrence.url || "unreported URL"} ${occurrence.resolved ? "open" : "fixed"}`}
                      />
                      {occurrence.url
                        ? <a href={occurrence.url} target="_blank" rel="noreferrer">{occurrence.url.replace(/^https?:\/\//, "")}<Icon name="external"/></a>
                        : <span>URL not reported</span>}
                    </div>;
                  })}
                </div>
              </details>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

type UrlOccurrence = {
  key: string;
  url: string;
  findingIds: string[];
  resolved: boolean;
};

type FindingGroup = Pick<Finding, "id" | "category" | "severity" | "title"> & {
  key: string;
  occurrences: number;
  resolvedCount: number;
  urls: UrlOccurrence[];
};

function groupFindings(
  findings: Finding[],
  statusById: Map<string, Finding["status"]>,
): FindingGroup[] {
  const groups = new Map<string, {
    representative: Finding;
    urls: Map<string, Finding[]>;
  }>();

  for (const finding of findings) {
    const groupKey = `${finding.category}\u0000${finding.ruleKey}\u0000${finding.title}`;
    const group = groups.get(groupKey) ?? {
      representative: finding,
      urls: new Map<string, Finding[]>(),
    };
    const affectedUrl = finding.resourceUrl || finding.pageUrl;
    const urlKey = affectedUrl || `unreported:${finding.id}`;
    group.urls.set(urlKey, [...(group.urls.get(urlKey) ?? []), finding]);
    groups.set(groupKey, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const urls = [...group.urls.entries()].map(([urlKey, members]) => ({
      key: urlKey,
      url: members[0]?.resourceUrl || members[0]?.pageUrl || "",
      findingIds: members.map((member) => member.id),
      resolved: members.every((member) => statusById.get(member.id) === "resolved"),
    }));
    return {
      id: group.representative.id,
      key,
      category: group.representative.category,
      severity: group.representative.severity,
      title: group.representative.title,
      occurrences: urls.length,
      resolvedCount: urls.filter((url) => url.resolved).length,
      urls,
    };
  });
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
