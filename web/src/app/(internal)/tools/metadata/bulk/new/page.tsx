import { PageHeader } from "@/components/app-shell";
import { ToolRunForm } from "@/components/tools/tool-run-form";

export const metadata = { title: "New bulk metadata run" };

export default function NewBulkMetadataPage() {
  return (
    <div className="narrow-page">
      <PageHeader
        eyebrow="Tools"
        title="Bulk metadata"
        description="Generate titles, meta descriptions, and H1s for every page. Existing sites keep current values for comparison; development sites get a complete first pass."
      />
      <ToolRunForm toolType="bulk_metadata" />
    </div>
  );
}
