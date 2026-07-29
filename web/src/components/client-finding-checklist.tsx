"use client";

import { useMemo, useState } from "react";

import type { Finding } from "@/lib/data/types";

import { Icon } from "./icons";

export function ClientFindingChecklist({
  findings,
  token,
}: {
  findings: Finding[];
  token: string;
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
  const groups = useMemo(
    () => groupFindings(findings, statusById),
    [findings, statusById],
  );
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

  return <section className="card client-checklist">
    <div className="section-title">
      <div>
        <h2>SEO remediation checklist</h2>
        <p>Open each group, implement the fix, then check off each distinct URL.</p>
      </div>
      <strong>{fixedUrls}/{totalUrls} fixed</strong>
    </div>
    <div className="progress"><span style={{ width: `${totalUrls ? (fixedUrls / totalUrls) * 100 : 0}%` }} /></div>
    <div className="filterbar" aria-label="Filter findings">
      {["All", "Critical", "High", "Medium", "Low", "Info"].map((value) => (
        <button
          key={value}
          className={filter === value ? "active" : ""}
          onClick={() => setFilter(value)}
        >
          {value}
          <span>{value === "All" ? groups.length : groups.filter((group) => group.severity === value).length}</span>
        </button>
      ))}
    </div>
    {message && <p className="inline-message finding-message" role="alert">{message}</p>}
    <div className="table-wrap">
      <table>
        <thead><tr><th>Finding</th><th>Severity</th><th>Occurrences</th><th>Affected URLs</th></tr></thead>
        <tbody>
          {visible.map((group) => <tr key={group.key}>
            <td><strong>{group.title}</strong><small>{group.category}</small></td>
            <td><span className={`severity severity-${group.severity.toLowerCase()}`}>{group.severity}</span></td>
            <td>{group.occurrences}</td>
            <td className="url-cell">
              <details>
                <summary>{group.resolvedCount}/{group.occurrences} fixed · View affected URLs</summary>
                <div className="finding-url-list">
                  {group.urls.map((occurrence) => {
                    const pendingKey = `${group.key}:${occurrence.key}`;
                    return <div key={occurrence.key} className={`finding-url-item${occurrence.resolved ? " resolved" : ""}`}>
                      <input
                        type="checkbox"
                        checked={occurrence.resolved}
                        disabled={updating.has(pendingKey)}
                        onChange={() => toggleUrl(group.key, occurrence)}
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
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

type UrlOccurrence = {
  key: string;
  url: string;
  findingIds: string[];
  resolved: boolean;
};

type FindingGroup = Pick<Finding, "category" | "severity" | "title"> & {
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
    const key = `${finding.category}\u0000${finding.ruleKey}\u0000${finding.title}`;
    const group = groups.get(key) ?? {
      representative: finding,
      urls: new Map<string, Finding[]>(),
    };
    const url = finding.resourceUrl || finding.pageUrl;
    const urlKey = url || `unreported:${finding.id}`;
    group.urls.set(urlKey, [...(group.urls.get(urlKey) ?? []), finding]);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const urls = [...group.urls.entries()].map(([urlKey, members]) => ({
      key: urlKey,
      url: members[0]?.resourceUrl || members[0]?.pageUrl || "",
      findingIds: members.map((member) => member.id),
      resolved: members.every((member) => statusById.get(member.id) === "resolved"),
    }));
    return {
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
