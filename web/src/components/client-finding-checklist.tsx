"use client";

import { useMemo, useState } from "react";

import type { Finding } from "@/lib/data/types";

import { AnalystReviewNotes, FindingInstances } from "./finding-instances";
import { groupFindings, type FindingInstance as UrlOccurrence } from "@/lib/finding-groups";

export function ClientFindingChecklist({
  findings,
  token,
  onStatusesChanged,
}: {
  findings: Finding[];
  token: string;
  onStatusesChanged: (
    findingIds: string[],
    status: Finding["status"],
  ) => void;
}) {
  const [filter, setFilter] = useState("All");
  const [message, setMessage] = useState("");
  const [statusOverrides, setStatusOverrides] = useState<Map<string, Finding["status"]>>(
    () => new Map(),
  );
  const [updating, setUpdating] = useState<Set<string>>(() => new Set());
  const statusById = useMemo(() => {
    const statuses = new Map(findings.map((finding) => [finding.id, finding.status]));
    statusOverrides.forEach((status, id) => statuses.set(id, status));
    return statuses;
  }, [findings, statusOverrides]);
  const allGroups = useMemo(() => groupFindings(findings, statusById), [findings, statusById]);
  const groups = allGroups.filter(group => group.kind !== "note");
  const notes = allGroups.filter(group => group.kind === "note");
  const visible = filter === "All"
    ? groups
    : groups.filter((group) => group.severity === filter);
  const totalUrls = groups.reduce((total, group) => total + group.occurrences, 0);
  const fixedUrls = groups.reduce((total, group) => total + group.resolvedCount, 0);

  async function toggleUrl(groupKey: string, occurrence: UrlOccurrence) {
    const pendingKey = `${groupKey}:${occurrence.key}`;
    const nextStatus: Finding["status"] = occurrence.resolved ? "open" : "resolved";
    const previous = new Map(statusOverrides);
    setMessage("");
    setUpdating((current) => new Set(current).add(pendingKey));
    setStatusOverrides((current) => {
      const next = new Map(current);
      occurrence.findingIds.forEach((id) => next.set(id, nextStatus));
      return next;
    });

    try {
      const response = await fetch(
        `/api/share/${encodeURIComponent(token)}/findings`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            findingIds: occurrence.findingIds,
            status: nextStatus,
          }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatusOverrides(previous);
        setMessage(body.error ?? "The URL status could not be updated.");
      } else {
        onStatusesChanged(occurrence.findingIds, nextStatus);
        setStatusOverrides((current) => {
          const next = new Map(current);
          occurrence.findingIds.forEach((id) => next.delete(id));
          return next;
        });
      }
    } catch {
      setStatusOverrides(previous);
      setMessage("The URL status could not be updated.");
    } finally {
      setUpdating((current) => {
        const next = new Set(current);
        next.delete(pendingKey);
        return next;
      });
    }
  }

  return <><section className="card client-checklist">
    <div className="section-title">
      <div>
        <h2>SEO remediation checklist</h2>
        <p>Open an issue, review its description, then check off each affected page, file, or link.</p>
      </div>
      <strong>{fixedUrls}/{totalUrls} fixed</strong>
    </div>
    <div className="progress"><span style={{ width: `${totalUrls ? (fixedUrls / totalUrls) * 100 : 0}%` }} /></div>
    <div className="filterbar" aria-label="Filter findings">
      {["All", "Critical", "High", "Medium", "Low", "Info"].map((value) => {
        const matchingGroups = value === "All"
          ? groups
          : groups.filter((group) => group.severity === value);
        const occurrenceCount = matchingGroups.reduce(
          (total, group) => total + group.occurrences,
          0,
        );
        return <button
          key={value}
          className={filter === value ? "active" : ""}
          onClick={() => setFilter(value)}
        >
          {value}
          <span>{occurrenceCount}</span>
        </button>;
      })}
    </div>
    {message && <p className="inline-message finding-message" role="alert">{message}</p>}
    <div className="table-wrap">
      <table className="client-finding-table">
        <thead><tr><th>Finding</th><th>Severity</th><th>Occurrences</th><th>Affected URLs</th></tr></thead>
        <tbody>
          {visible.map((group) => <tr key={group.key}>
            <td><strong>{group.title}</strong><small>{group.category}</small></td>
            <td><span className={`severity severity-${group.severity.toLowerCase()}`}>{group.severity}</span></td>
            <td>{group.occurrences}</td>
            <td className="url-cell">
              <FindingInstances group={group} updatingKeys={updating} onToggle={instance => toggleUrl(group.key, instance)}/>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section><AnalystReviewNotes groups={notes} updatingKeys={updating} onToggle={(group, instance) => toggleUrl(group.key, instance)}/></>;
}
