"use client";

import { useState } from "react";

import type { KeywordStrategyItem } from "@/lib/data/types";

type ApprovedTarget = {
  id: string;
  keyword: string;
  canonical_url: string;
  role: "primary" | "secondary";
};

export function KeywordStrategyReview({
  auditId,
  keywords,
  initialTargets,
}: {
  auditId?: string;
  keywords: KeywordStrategyItem[];
  initialTargets: ApprovedTarget[];
}) {
  const [targets, setTargets] = useState(initialTargets);
  const [updating, setUpdating] = useState("");
  const [error, setError] = useState("");
  const approved = new Set(
    targets.map((target) => `${target.keyword.toLowerCase()}\n${target.canonical_url}`),
  );

  async function approve(item: KeywordStrategyItem) {
    if (!auditId) return;
    setUpdating(item.keyword);
    setError("");
    const response = await fetch(`/api/audits/${auditId}/keyword-targets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        keyword: item.keyword,
        canonicalUrl: item.assigned_page,
        role: "primary",
        metrics: {
          volume: item.volume,
          cpc: item.cpc,
          difficulty: item.difficulty,
          competition: item.competition,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error ?? "The keyword target could not be approved.");
    } else {
      setTargets((current) => [
        ...current.filter(
          (target) =>
            target.canonical_url !== payload.target.canonical_url
            && target.keyword.toLowerCase() !== payload.target.keyword.toLowerCase(),
        ),
        payload.target,
      ]);
    }
    setUpdating("");
  }

  return (
    <section className="card report-section">
      <div className="section-title">
        <div>
          <h2>Keyword research & strategy</h2>
          <p>Approve a page target once. Future audits refresh its metrics without replacing the keyword or page.</p>
        </div>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Keyword</th><th>Source</th><th>Intent</th><th>Position</th><th>Volume</th><th>CPC</th><th>Difficulty</th><th>Target page</th><th>Decision</th></tr></thead>
          <tbody>
            {keywords.map((item) => {
              const isApproved = item.source === "approved"
                || approved.has(`${item.keyword.toLowerCase()}\n${item.assigned_page}`);
              return <tr key={`${item.source}-${item.keyword}`}>
                <td><strong>{item.keyword}</strong></td>
                <td>{isApproved ? "approved" : item.source}</td>
                <td>{item.intent}</td>
                <td>{item.position ?? "—"}</td>
                <td>{formatNumber(item.volume)}</td>
                <td>{formatCurrency(item.cpc)}</td>
                <td>{item.difficulty || "—"}</td>
                <td className="url-cell"><a href={item.assigned_page} target="_blank" rel="noreferrer">{stripProtocol(item.assigned_page)}</a></td>
                <td>{isApproved
                  ? <span className="status-badge complete">Locked</span>
                  : auditId
                    ? <button className="button secondary small" type="button" disabled={Boolean(updating)} onClick={() => approve(item)}>{updating === item.keyword ? "Saving…" : "Approve target"}</button>
                    : <span>Proposed</span>}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function stripProtocol(value: string) {
  return value.replace(/^https?:\/\//, "");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}
