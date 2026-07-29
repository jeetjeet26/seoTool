import { PageHeader } from "@/components/app-shell";
import { ToolRunForm } from "@/components/tools/tool-run-form";

export const metadata = { title: "New listing optimization run" };

export default function NewListingOptimizationPage() {
  return (
    <div className="narrow-page">
      <PageHeader
        eyebrow="Tools"
        title="Listing optimization"
        description="Rewrite a third-party property listing (Greystar or any other provider) around the target keywords."
      />
      <ToolRunForm toolType="listing_optimization" />
    </div>
  );
}
