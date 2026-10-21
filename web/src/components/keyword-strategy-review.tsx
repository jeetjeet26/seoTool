"use client";

import { useState } from "react";

import { mergeApprovedTarget, targetKey, targetRole } from "@/lib/keyword-targets";

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
    targets.map((target) => targetKey(target.keyword, target.canonical_url)),
  );

  async function approve(item: KeywordStrategyItem) {
    if (!auditId) return;
    setUpdating(item.keyword);
    setError("");
    try {
      const response = await fetch(`/api/audits/${auditId}/keyword-targets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          keyword: item.keyword,
          canonicalUrl: item.assigned_page,
          role: targetRole(targets, item.assigned_page),
          metrics: item.source === "analyst_provided_metrics_pending" ? {} : {
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
        if (!payload.target?.keyword || !payload.target?.canonical_url) {
          throw new Error("The server returned an invalid approval response. Refresh and try again.");
        }
        setTargets((current) => mergeApprovedTarget(current, payload.target));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "The keyword target could not be approved. Please try again.");
    } finally {
      setUpdating("");
    }
  }

  return (
    <section className="card report-section">
      <div className="section-title">
        <div>
          <h2>Keyword research & strategy</h2>
          <p>Approve a page target once. The first keyword for a page is primary; additional approvals are secondary. Future audits keep these choices.</p>
        </div>
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Keyword</th><th>Source</th><th>Intent</th><th>Position</th><th>Volume</th><th>CPC</th><th>Difficulty</th><th>Target page</th><th>Decision</th></tr></thead>
          <tbody>
            {keywords.map((item) => {
              const isApproved = (!auditId && item.source === "approved")
                || approved.has(targetKey(item.keyword, item.assigned_page));
              const metricsPending = item.source === "analyst_provided_metrics_pending";
              return <tr key={`${item.source}-${item.keyword}`}>
                <td><strong>{item.keyword}</strong></td>
                <td>{isApproved ? "approved" : item.source === "approved" ? "proposed" : metricsPending ? "Analyst review · metrics pending" : item.source}</td>
                <td>{item.intent}</td>
                <td>{item.position ?? "—"}</td>
                <td>{metricsPending ? "Pending" : formatNumber(item.volume)}</td>
                <td>{metricsPending ? "Pending" : formatCurrency(item.cpc)}</td>
                <td>{metricsPending ? "Pending" : item.difficulty || "—"}</td>
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
