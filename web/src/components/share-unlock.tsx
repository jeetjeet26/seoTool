"use client";

import { useEffect, useState } from "react";

import type { PortalPayload, PortalProgress } from "@/lib/share/types";

import { AuditInsights } from "./audit-insights";
import { ClientFindingChecklist } from "./client-finding-checklist";
import { Icon } from "./icons";

export function ShareUnlock({ token }: { token: string }) {
  const [portal, setPortal] = useState<PortalPayload | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function hydrate() {
      try {
        const response = await fetch(`/api/share/${encodeURIComponent(token)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.ok) {
          const body = (await response.json()) as { portal?: PortalPayload };
          if (body.portal) setPortal(body.portal);
        }
      } catch {
        // The PIN form remains available when no active session exists.
      }
      if (!stopped) timer = setTimeout(refresh, 5000);
    }

    async function refresh() {
      if (document.visibilityState !== "hidden") {
        try {
          const response = await fetch(
            `/api/share/${encodeURIComponent(token)}/progress`,
            { signal: controller.signal, cache: "no-store" },
          );
          if (response.ok) {
            const body = (await response.json()) as { progress?: PortalProgress };
            if (body.progress) {
              const progress = body.progress;
              const statuses = new Map(
                progress.findings.map((finding) => [finding.id, finding.status]),
              );
              setPortal((current) => current ? {
                ...current,
                completedTasks: progress.completedTasks,
                totalTasks: progress.totalTasks,
                tasks: progress.tasks,
                findings: current.findings.map((finding) => ({
                  ...finding,
                  status: statuses.get(finding.id) ?? finding.status,
                })),
              } : current);
            }
          }
        } catch {
          // Keep the last successful state during a transient refresh failure.
        }
      }
      if (!stopped) timer = setTimeout(refresh, 5000);
    }

    void hydrate();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [token]);

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/share/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, pin: String(form.get("pin") ?? "") }),
      });
      const body = (await response.json()) as {
        portal?: PortalPayload;
        error?: string;
      };
      if (!response.ok || !body.portal) {
        setError(body.error ?? "The report could not be unlocked.");
        return;
      }
      setPortal(body.portal);
    } catch {
      setError("The report could not be unlocked. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (portal) {
    const progress =
      portal.totalTasks > 0
        ? Math.round((portal.completedTasks / portal.totalTasks) * 100)
        : 0;
    const findingsRevision = portal.findings
      .map((finding) => `${finding.id}:${finding.status}`)
      .join("|");
    return <div className="share-report">
      <div className="share-heading"><div><p className="eyebrow">Shared audit</p><h1>{portal.clientName}</h1><p>{portal.reportName}</p></div>{portal.score !== null && <span className="score-ring">{portal.score}<small>/100</small></span>}</div>
      <ClientFindingChecklist key={findingsRevision} findings={portal.findings} token={token}/>
      <AuditInsights summary={portal.summary}/>
      {portal.totalTasks > 0 && <>
        <section className="card"><div className="section-title"><div><h2>Assigned task progress</h2><p>{portal.completedTasks} of {portal.totalTasks} assigned tasks completed</p></div><strong>{progress}%</strong></div><div className="progress"><span style={{ width: `${progress}%` }} /></div></section>
        <section className="task-list">
          {portal.tasks.map((task) => {
            const done = task.status === "done";
            return <div className="task" key={task.id}><span className={`task-check ${done ? "done" : ""}`}><Icon name="check"/></span><div><strong>{task.title}</strong><small>{task.priority} priority · {task.status.replace("_", " ")}</small></div></div>;
          })}
        </section>
      </>}
    </div>;
  }

  return <div className="unlock-card">
    <span className="logo-mark large">A</span><p className="eyebrow">Secure client portal</p><h1>View your audit</h1><p>Enter the PIN provided with your private report link.</p>
    <form onSubmit={unlock}>
      <label>Access PIN<input name="pin" inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" aria-describedby="access-note" /></label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="button primary full" type="submit" disabled={pending}>{pending ? "Unlocking…" : "Unlock report"}</button>
    </form>
    <small id="access-note">The report link and PIN are validated securely.</small>
  </div>;
}
