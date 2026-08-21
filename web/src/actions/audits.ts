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
  const secondaryMarket = String(
    formData.get("secondaryMarket") ?? "",
  ).trim();
  const rawCompetitors = String(
    formData.get("competitors") ?? formData.get("competitorDomains") ?? "",
  ).trim();
  const pageLimit = Number(formData.get("pageLimit"));
  const reportVariant = String(formData.get("reportVariant") ?? "full_client");
  const crawlSource = String(formData.get("crawlSource") ?? "cloud");
  const hasLocalUpload = formData.get("hasLocalUpload") === "yes";
  const communityType = String(
    formData.get("communityType") ?? "multifamily",
  );
  const eventPageTreatment = String(
    formData.get("eventPageTreatment") ?? "event_details",
  );
  let nearbyNeighborhoods: string[];
  let excludedKeywords: string[];
  try {
    nearbyNeighborhoods = parseSimpleLines(
      String(formData.get("nearbyNeighborhoods") ?? ""),
      25,
      "nearby neighborhood",
    );
    excludedKeywords = parseSimpleLines(
      String(formData.get("excludedKeywords") ?? ""),
      25,
      "excluded keyword",
    );
  } catch (error) {
    return {
      error: error instanceof CompetitorInputError
        ? error.message
        : "The targeting inputs could not be validated.",
    };
  }

  if (!clientName || !targetUrl || !targetCity) {
    return { error: "Client name, website URL, and city are required." };
  }
  if (secondaryMarket.length > 160) {
    return { error: "Metro or secondary market must be 160 characters or fewer." };
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
  let competitors: ParsedCompetitors;
  try {
    competitors = parseCompetitors(
      rawCompetitors,
      targetDomain,
    );
  } catch (error) {
    return {
      error: error instanceof CompetitorInputError
        ? error.message
        : "Competitor domains could not be validated.",
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
  if (!["full_audit", "event_details"].includes(eventPageTreatment)) {
    return { error: "Choose a valid event-page treatment." };
  }
  if (
    ![
      "multifamily",
      "senior_living",
      "new_homes",
      "master_planned",
      "luxury_living",
    ].includes(communityType)
  ) {
    return { error: "Choose a valid community type." };
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
        competitor_domains: competitors.domains,
        competitor_names: competitors.names,
        report_variant: reportVariant,
        crawl_source: crawlSource,
        sitemap_only:
          formData.get("sitemapOnly") === "on" ||
          targetDomain === "ariseknoxsquare.com",
        community_type: communityType,
        secondary_market: secondaryMarket,
        nearby_neighborhoods: nearbyNeighborhoods,
        excluded_keywords: excludedKeywords,
        event_page_treatment:
          eventPageTreatment === "full_audit" ? "full_audit" : "event_details",
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

interface ParsedCompetitors {
  domains: string[];
  names: string[];
}

function parseCompetitors(raw: string, targetDomain: string): ParsedCompetitors {
  if (!raw) return { domains: [], names: [] };
  const values = raw
    .split(/[\r\n;]+/)
    .map((value) => cleanCompetitorLine(value))
    .filter(Boolean);
  if (values.length > 10) {
    throw new CompetitorInputError(
      `You entered ${values.length} competitor lines; the maximum is 10.`,
    );
  }

  const domains: string[] = [];
  const names: string[] = [];
  values.forEach((value, index) => {
    if (!looksLikeDomain(value)) {
      if (
        value.length > 200
        || !/[a-z\d]/i.test(value)
        || /[<>]/.test(value)
      ) {
        throw new CompetitorInputError(
          `Competitor line ${index + 1} is not a valid community name or domain.`,
        );
      }
      names.push(value);
      return;
    }
    try {
      const parsed = new URL(
        /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`,
      );
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      const domain = normalizeDomain(parsed.hostname);
      if (!isValidDomain(domain)) throw new Error();
      if (domain === targetDomain) {
        throw new CompetitorInputError(
          `Competitor line ${index + 1} matches the audited website.`,
        );
      }
      domains.push(domain);
    } catch (error) {
      if (error instanceof CompetitorInputError) throw error;
      throw new CompetitorInputError(
        `Competitor line ${index + 1} is not a valid domain: "${value}".`,
      );
    }
  });
  return {
    domains: [...new Set(domains)],
    names: [...new Set(names)],
  };
}

function parseSimpleLines(
  raw: string,
  maximum: number,
  label: string,
): string[] {
  const values = raw
    .split(/[\r\n;]+/)
    .map((value) => cleanCompetitorLine(value))
    .filter(Boolean);
  if (values.length > maximum) {
    throw new CompetitorInputError(
      `You entered ${values.length} ${label} lines; the maximum is ${maximum}.`,
    );
  }
  const invalidIndex = values.findIndex(
    (value) => value.length > 200 || !/[a-z\d]/i.test(value) || /[<>]/.test(value),
  );
  if (invalidIndex >= 0) {
    throw new CompetitorInputError(
      `${label[0].toUpperCase()}${label.slice(1)} line ${invalidIndex + 1} is invalid.`,
    );
  }
  return [...new Set(values)];
}

class CompetitorInputError extends Error {}

function cleanCompetitorLine(value: string): string {
  return value
    .trim()
    .replace(/^\[+|\]+$/g, "")
    .replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "")
    .replace(/[,.]+$/, "")
    .trim();
}

function looksLikeDomain(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    || (!/\s/.test(value) && value.includes("."));
}

function isValidDomain(value: string): boolean {
  return value.includes(".")
    && value.length <= 253
    && value.split(".").every(
      (label) => (
        label.length >= 1
        && label.length <= 63
        && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
      ),
    );
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "");
}
