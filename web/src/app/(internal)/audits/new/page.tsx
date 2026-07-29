import { PageHeader } from "@/components/app-shell";
import { AuditForm } from "@/components/audit-form";

export const metadata = { title: "New audit" };

export default function NewAuditPage() {
  return <div className="narrow-page"><PageHeader eyebrow="New audit" title="Configure a site scan" description="Set a crawl target and choose the checks to include."/><AuditForm/></div>;
}
