import { PageHeader } from "@/components/app-shell";
import { ToolRunForm } from "@/components/tools/tool-run-form";

export const metadata = { title: "New keyword research" };

export default function NewKeywordResearchPage() {
  return (
    <div className="narrow-page">
      <PageHeader
        eyebrow="Tools"
        title="Keyword research"
        description="Discover, score, and map keywords to landing pages using Semrush rankings, related keywords, and backlink authority."
      />
      <ToolRunForm toolType="keyword_research" />
    </div>
  );
}
