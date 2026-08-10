"use server";

import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface QueueAuditState {
  message?: string;
  error?: string;
  auditId?: string;
  uploadMode?: "local" | "fallback";
}

export async function queueAudit(
  _previousState: QueueAuditState,
  formData: FormData,
): Promise<QueueAuditState> {
  const clientName = String(formData.get("clientName") ?? "").trim();
  const targetUrl = String(formData.get("targetUrl") ?? "").trim();
  const targetCity = String(formData.get("targetCity") ?? "").trim();
  const targetRegion = String(formData.get("targetRegion") ?? "").trim();
  const rawCompetitorDomains = String(
    formData.get("competitorDomains") ?? "",
  ).trim();
  const pageLimit = Number(formData.get("pageLimit"));
  const reportVariant = String(formData.get("reportVariant") ?? "full_client");
  const crawlSource = String(formData.get("crawlSource") ?? "cloud");
  const hasLocalUpload = formData.get("hasLocalUpload") === "yes";

  if (!clientName || !targetUrl || !targetCity) {
    return { error: "Client name, website URL, and city are required." };
  }
  let normalizedTargetUrl: string;
  let websiteUrl: string;
  let targetDomain: string;
  try {
    const parsed = new URL(targetUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    normalizedTargetUrl = parsed.toString();
    websiteUrl = parsed.origin;
    targetDomain = normalizeDomain(parsed.hostname);
  } catch {
    return { error: "Enter a valid HTTP or HTTPS website URL." };
  }
  let competitorDomains: string[];
  try {
    competitorDomains = parseCompetitorDomains(
      rawCompetitorDomains,
      targetDomain,
    );
  } catch {
    return {
      error: "Enter up to 10 valid competitor domains, one per line.",
    };
  }
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 1000) {
    return { error: "Page limit must be between 1 and 1,000." };
  }
  if (!["full_client", "in_house"].includes(reportVariant)) {
    return { error: "Choose a valid report variant." };
  }
  if (!["cloud", "local", "cloud_fallback"].includes(crawlSource)) {
    return { error: "Choose a valid crawl source." };
  }
  if (crawlSource === "local" && !hasLocalUpload) {
    return { error: "Choose a Screaming Frog ZIP or CSV files for local import." };
  }
  const awaitingUpload = hasLocalUpload && crawlSource !== "cloud";

  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) {
    return { error: "Your session expired. Sign in and try again." };
  }

  const { data: existingClient, error: lookupError } = await supabase
    .from("clients")
    .select("id")
    .eq("name_key", clientName.toLowerCase())
    .limit(1)
    .maybeSingle();
  if (lookupError) {
    return { error: "The client could not be checked. Please try again." };
  }

  let clientId = existingClient?.id;
  if (!clientId) {
    const { data: createdClient, error: clientError } = await supabase
      .from("clients")
      .insert({
        name: clientName,
        website_url: websiteUrl,
        created_by: claimsData.claims.sub,
      })
      .select("id")
      .single();
    if (clientError || !createdClient) {
      return { error: "The client could not be created. Please try again." };
    }
    clientId = createdClient.id;
  }

  const { data, error } = await supabase
    .from("audits")
    .insert({
      client_id: clientId,
      name: `${targetCity} SEO audit`,
      target_url: normalizedTargetUrl,
      target_city: targetCity,
      target_region: targetRegion || null,
      page_limit: pageLimit,
      run_performance: formData.get("runPerformance") === "on",
      run_accessibility: formData.get("runAccessibility") === "on",
      options: {
        competitor_domains: competitorDomains,
        report_variant: reportVariant,
        crawl_source: crawlSource,
      },
      status: awaitingUpload ? "draft" : "queued",
      current_stage: awaitingUpload ? "awaiting_upload" : "queued",
      requested_by: claimsData.claims.sub,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: "The audit could not be queued. Please try again." };
  }

  if (awaitingUpload) {
    return {
      auditId: data.id,
      uploadMode: crawlSource === "local" ? "local" : "fallback",
      message: "Audit created. Uploading local crawl files.",
    };
  }
  redirect(`/audits/${data.id}`);
}

function parseCompetitorDomains(raw: string, targetDomain: string): string[] {
  if (!raw) return [];
  const values = raw
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length > 10) throw new Error("Too many competitors");

  const domains = values.map((value) => {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`,
    );
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    const domain = normalizeDomain(parsed.hostname);
    if (!domain.includes(".") || domain === targetDomain) throw new Error();
    return domain;
  });
  return [...new Set(domains)];
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "");
}
