import { PageHeader } from "@/components/app-shell";
import { ToolRunForm } from "@/components/tools/tool-run-form";

export const metadata = { title: "New local listing audit" };

export default function NewLocalAuditPage() {
  return (
    <div className="narrow-page">
      <PageHeader
        eyebrow="Tools"
        title="Local listing audit"
        description="A staff-verifiable checklist covering Google Business Profile, Google Maps, Bing Maps, Apple Maps, and off-site NAP consistency."
      />
      <ToolRunForm toolType="local_audit" />
    </div>
  );
}
