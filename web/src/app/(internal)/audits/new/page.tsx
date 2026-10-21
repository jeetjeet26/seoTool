import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell";
import { AuditForm } from "@/components/audit-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { needsAdvisory, onboardingProgress, type Onboarding } from "@/lib/onboarding";
export const metadata = { title: "New audit" };
export default async function NewAuditPage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const { clientId } = await searchParams;
  let initial;
  let onboarding: Onboarding | undefined;
  if (clientId) {
    const supabase = await createSupabaseServerClient();
    const { data: client } = await supabase.from("clients").select("id,name,website_url,intake").eq("id", clientId).maybeSingle();
    if (!client) notFound();
    onboarding = client.intake?.onboarding;
    initial = { clientId: client.id, name: client.name, url: client.website_url, vertical: client.intake?.vertical === "senior_housing" ? "senior_living" : client.intake?.vertical, competitors: client.intake?.competitors };
  }
  const progress = onboardingProgress(onboarding);
  return <div className="narrow-page"><PageHeader eyebrow="New audit" title="Configure a site scan" description="Set a crawl target and choose the checks to include."/>{clientId && <aside className="notice"><p>SEO onboarding: {progress.done}/{progress.total} checkpoints complete. {onboarding && needsAdvisory(onboarding) ? "CMS-dependent recommendations require a client/vendor handoff." : "Review scope and outstanding access before starting."}</p><Link href={`/clients/${clientId}/intake`}>Review onboarding</Link><p>Pending access does not prevent scheduling an audit. Record unavailable checks in the onboarding audit notes.</p></aside>}<AuditForm initial={initial}/></div>;
}
