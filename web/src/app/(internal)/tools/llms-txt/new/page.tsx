import { PageHeader } from "@/components/app-shell";
import { ToolRunForm } from "@/components/tools/tool-run-form";

export const metadata = { title: "New llms.txt run" };

export default function NewLlmsTxtPage() {
  return (
    <div className="narrow-page">
      <PageHeader
        eyebrow="Tools"
        title="llms.txt"
        description="Generate a deterministic llms.txt from the site's sitemap and page metadata. An optional publishing artifact, not a ranking guarantee."
      />
      <ToolRunForm toolType="llms_txt" />
    </div>
  );
}
