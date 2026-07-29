import { PageHeader } from "@/components/app-shell";
import { ToolRunForm } from "@/components/tools/tool-run-form";

export const metadata = { title: "New schema run" };

export default function NewSchemaPage() {
  return (
    <div className="narrow-page">
      <PageHeader
        eyebrow="Tools"
        title="Schema markup"
        description="Build validated ApartmentComplex and FloorPlan JSON-LD from the facts you supply. Nothing is invented."
      />
      <ToolRunForm toolType="schema_generation" />
    </div>
  );
}
