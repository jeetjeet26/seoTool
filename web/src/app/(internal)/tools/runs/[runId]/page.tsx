import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader, Status } from "@/components/app-shell";
import { RunAutoRefresh } from "@/components/tools/run-progress";
import { ToolRunReview } from "@/components/tools/tool-run-review";
import { data } from "@/lib/data";
import type { ToolType } from "@/lib/data/types";

export const metadata = { title: "Tool run" };
export const dynamic = "force-dynamic";

const TOOL_LABELS: Record<ToolType, string> = {
  keyword_research: "Keyword research",
  bulk_metadata: "Bulk metadata",
  one_off_metadata: "One-off metadata",
  schema_generation: "Schema markup",
  llms_txt: "llms.txt",
  local_audit: "Local listing audit",
  listing_optimization: "Listing optimization",
};

const EXPORTS_BY_TOOL: Record<ToolType, Array<{ profile: string; label: string }>> = {
  keyword_research: [{ profile: "keywords", label: "Keyword CSV" }],
  bulk_metadata: [
    { profile: "csv", label: "Metadata CSV" },
    { profile: "developer", label: "Developer compilation CSV" },
    { profile: "seopress", label: "SEOPress import CSV" },
  ],
  one_off_metadata: [
    { profile: "csv", label: "Metadata CSV" },
    { profile: "developer", label: "Developer compilation CSV" },
  ],
  schema_generation: [{ profile: "schema", label: "JSON-LD snippet" }],
  llms_txt: [{ profile: "llms", label: "llms.txt" }],
  local_audit: [{ profile: "local", label: "Checklist CSV" }],
  listing_optimization: [{ profile: "csv", label: "Copy CSV" }],
};

export default async function ToolRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = await data.getToolRun(runId);
  if (!run) notFound();

  const items = run.status === "completed" ? await data.getToolRunItems(runId) : [];
  const running = run.status === "queued" || run.status === "running";
  const hasTemplate =
    run.toolType === "bulk_metadata"
      ? (await data.getToolArtifacts(runId)).some(
          (artifact) => artifact.kind === "seopress-template",
        )
      : false;
  const exports = EXPORTS_BY_TOOL[run.toolType].filter(
    (entry) => entry.profile !== "seopress" || hasTemplate,
  );

  return (
    <div>
      <RunAutoRefresh active={running} />
      <div className="breadcrumbs">
        <Link href="/tools">Tools</Link>
        <span>/</span>
        <span>{run.name}</span>
      </div>
      <PageHeader
        eyebrow={TOOL_LABELS[run.toolType]}
        title={run.name}
        description={`Client: ${run.clientName}`}
        action={<Status value={run.status} />}
      />

      {running ? (
        <div className="card">
          <div className="section-title">
            <div>
              <h2>Run in progress</h2>
              <p>
                Stage: {run.currentStage} · {run.progress}% — this page refreshes
                automatically.
              </p>
            </div>
          </div>
          <div className="mini-progress" style={{ margin: 20 }}>
            <span style={{ width: `${run.progress}%` }} />
          </div>
        </div>
      ) : null}

      {run.status === "failed" ? (
        <div className="card">
          <div className="section-title">
            <div>
              <h2>Run failed</h2>
              <p>{run.failureMessage ?? "The run failed without a message."}</p>
            </div>
          </div>
        </div>
      ) : null}

      {run.status === "completed" ? (
        <>
          <SummaryMetrics summary={run.summary} />
          <div className="card" style={{ marginTop: 18 }}>
            <div className="section-title">
              <div>
                <h2>Review and approve</h2>
                <p>
                  Edit anything inline, then approve the items that should ship.
                  Exports only ever include approved items.
                </p>
              </div>
              <div className="action-row">
                {exports.map((entry) => (
                  <a
                    className="button secondary compact"
                    key={entry.profile}
                    href={`/api/tools/runs/${run.id}/export?profile=${entry.profile}`}
                  >
                    {entry.label}
                  </a>
                ))}
              </div>
            </div>
            <ToolRunReview runId={run.id} items={items} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function SummaryMetrics({ summary }: { summary: Record<string, unknown> }) {
  const entries = Object.entries(summary)
    .filter(([, value]) => typeof value === "number" || typeof value === "string")
    .slice(0, 4);
  if (!entries.length) return null;
  return (
    <div className="metrics">
      {entries.map(([key, value]) => (
        <article key={key}>
          <span>{key.replaceAll("_", " ")}</span>
          <strong>{String(value)}</strong>
        </article>
      ))}
    </div>
  );
}
