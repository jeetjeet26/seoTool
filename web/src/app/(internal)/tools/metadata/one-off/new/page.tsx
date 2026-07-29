import { PageHeader } from "@/components/app-shell";
import { ToolRunForm } from "@/components/tools/tool-run-form";

export const metadata = { title: "New one-off writing run" };

export default function NewOneOffMetadataPage() {
  return (
    <div className="narrow-page">
      <PageHeader
        eyebrow="Tools"
        title="One-off writing"
        description="Write a focused title, meta description, and H1 for one page, with rationale and character guidance."
      />
      <ToolRunForm toolType="one_off_metadata" />
    </div>
  );
}
