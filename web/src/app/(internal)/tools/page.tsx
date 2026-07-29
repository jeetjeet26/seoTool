import Link from "next/link";

import { PageHeader, Status } from "@/components/app-shell";
import { data } from "@/lib/data";
import type { ToolType } from "@/lib/data/types";

export const metadata = { title: "Tools" };
export const dynamic = "force-dynamic";

const TOOLS: Array<{
  href: string;
  toolType: ToolType;
  title: string;
  description: string;
}> = [
  {
    href: "/tools/keywords/new",
    toolType: "keyword_research",
    title: "Keyword research",
    description:
      "Semrush rankings, related keywords, and backlinks scored and mapped to landing pages.",
  },
  {
    href: "/tools/metadata/bulk/new",
    toolType: "bulk_metadata",
    title: "Bulk metadata",
    description:
      "Titles, descriptions, and H1s for every page — from a sitemap or an uploaded SEOPress template.",
  },
  {
    href: "/tools/metadata/one-off/new",
    toolType: "one_off_metadata",
    title: "One-off writing",
    description: "A focused title and description for a single page.",
  },
  {
    href: "/tools/schema/new",
    toolType: "schema_generation",
    title: "Schema markup",
    description:
      "Validated JSON-LD for apartment communities and floor plans from supplied facts.",
  },
  {
    href: "/tools/llms-txt/new",
    toolType: "llms_txt",
    title: "llms.txt",
    description: "A deterministic llms.txt generated from the site's sitemap.",
  },
  {
    href: "/tools/local-audit/new",
    toolType: "local_audit",
    title: "Local listing audit",
    description:
      "Checklist for Google, Bing, and Apple Maps listings plus off-site NAP consistency.",
  },
  {
    href: "/tools/listing/new",
    toolType: "listing_optimization",
    title: "Listing optimization",
    description: "Rewrites third-party listing copy around target keywords.",
  },
];

const TOOL_LABELS: Record<ToolType, string> = {
  keyword_research: "Keyword research",
  bulk_metadata: "Bulk metadata",
  one_off_metadata: "One-off metadata",
  schema_generation: "Schema markup",
  llms_txt: "llms.txt",
  local_audit: "Local listing audit",
  listing_optimization: "Listing optimization",
};

export default async function ToolsPage() {
  const runs = await data.getToolRuns();

  return (
    <div>
      <PageHeader
        eyebrow="Tools"
        title="SEO tools"
        description="Standalone workflows for keyword strategy, metadata, schema, llms.txt, and local SEO. Every output is reviewed and approved before export."
      />
      <div className="client-grid">
        {TOOLS.map((tool) => (
          <Link className="client-card" href={tool.href} key={tool.href}>
            <h2>{tool.title}</h2>
            <p>{tool.description}</p>
          </Link>
        ))}
      </div>
      <div className="card" style={{ marginTop: 22 }}>
        <div className="section-title">
          <div>
            <h2>Recent runs</h2>
            <p>The latest tool runs across all clients.</p>
          </div>
        </div>
        {runs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Client</th>
                  <th>Tool</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link className="text-link" href={`/tools/runs/${run.id}`}>
                        {run.name}
                      </Link>
                    </td>
                    <td>{run.clientName}</td>
                    <td>{TOOL_LABELS[run.toolType]}</td>
                    <td>
                      <Status value={run.status} />
                    </td>
                    <td>{run.progress}%</td>
                    <td>{new Date(run.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>No tool runs yet</strong>
            <p>Pick a tool above to start the first run.</p>
          </div>
        )}
      </div>
    </div>
  );
}
