"use server";

import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ToolType } from "@/lib/data/types";

export interface ToolRunState {
  error?: string;
}

const TOOL_LABELS: Record<ToolType, string> = {
  keyword_research: "Keyword research",
  bulk_metadata: "Bulk metadata",
  one_off_metadata: "One-off metadata",
  schema_generation: "Schema markup",
  llms_txt: "llms.txt",
  local_audit: "Local listing audit",
  listing_optimization: "Listing optimization",
};

const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function list(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function createToolRun(
  _previousState: ToolRunState,
  formData: FormData,
): Promise<ToolRunState> {
  const toolType = String(formData.get("toolType") ?? "") as ToolType;
  const clientName = String(formData.get("clientName") ?? "").trim();

  if (!TOOL_LABELS[toolType]) {
    return { error: "Unknown tool type." };
  }
  if (!clientName) {
    return { error: "Client name is required." };
  }
  if (!isSupabaseConfigured) {
    return { error: "Supabase is not configured." };
  }

  const built = buildOptions(toolType, formData);
  if ("error" in built) {
    return { error: built.error };
  }
  const { options, websiteUrl } = built;

  const templateFile = formData.get("templateFile");
  let templateBytes: Uint8Array | null = null;
  if (templateFile instanceof File && templateFile.size > 0) {
    if (toolType !== "bulk_metadata") {
      return { error: "Templates are only used by bulk metadata runs." };
    }
    if (templateFile.size > MAX_TEMPLATE_BYTES) {
      return { error: "The template must be smaller than 5 MB." };
    }
    if (!templateFile.name.toLowerCase().endsWith(".csv")) {
      return { error: "The template must be a .csv export." };
    }
    templateBytes = new Uint8Array(await templateFile.arrayBuffer());
    // A cheap signature check: reject obvious binary uploads renamed to .csv.
    if (templateBytes.slice(0, 512).some((byte) => byte === 0)) {
      return { error: "The template does not look like a CSV text file." };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) {
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
    if (!websiteUrl) {
      return {
        error:
          "This client does not exist yet. Include a website URL so it can be created.",
      };
    }
    const { data: createdClient, error: clientError } = await supabase
      .from("clients")
      .insert({
        name: clientName,
        website_url: websiteUrl,
        created_by: userId,
      })
      .select("id")
      .single();
    if (clientError || !createdClient) {
      return { error: "The client could not be created. Please try again." };
    }
    clientId = createdClient.id;
  }

  const { data: run, error: runError } = await supabase
    .from("tool_runs")
    .insert({
      client_id: clientId,
      tool_type: toolType,
      name: `${TOOL_LABELS[toolType]} — ${clientName}`,
      status: "queued",
      current_stage: "queued",
      options,
      requested_by: userId,
    })
    .select("id")
    .single();
  if (runError || !run) {
    return { error: "The tool run could not be queued. Please try again." };
  }

  if (templateBytes) {
    const objectPath = `${run.id}/input/template.csv`;
    const { error: uploadError } = await supabase.storage
      .from("tool-artifacts")
      .upload(objectPath, templateBytes, {
        contentType: "text/csv",
        upsert: true,
      });
    if (uploadError) {
      await supabase.from("tool_runs").delete().eq("id", run.id);
      return { error: "The template could not be uploaded. Please try again." };
    }
    const { error: artifactError } = await supabase.from("tool_artifacts").insert({
      run_id: run.id,
      kind: "seopress-template",
      object_path: objectPath,
      content_type: "text/csv",
      byte_size: templateBytes.byteLength,
      created_by: userId,
    });
    if (artifactError) {
      return { error: "The template metadata could not be saved." };
    }
  }

  redirect(`/tools/runs/${run.id}`);
}

function buildOptions(
  toolType: ToolType,
  formData: FormData,
): { options: Record<string, unknown>; websiteUrl?: string } | { error: string } {
  switch (toolType) {
    case "keyword_research": {
      const targetUrl = parseUrl(String(formData.get("targetUrl") ?? "").trim());
      const location = String(formData.get("location") ?? "").trim();
      if (!targetUrl) return { error: "Enter a valid website URL." };
      if (!location) return { error: "Target location is required." };
      return {
        options: {
          target_url: targetUrl.toString(),
          location,
          property_name: String(formData.get("propertyName") ?? "").trim(),
        },
        websiteUrl: targetUrl.origin,
      };
    }
    case "bulk_metadata": {
      const rawUrl = String(formData.get("targetUrl") ?? "").trim();
      const targetUrl = rawUrl ? parseUrl(rawUrl) : null;
      const hasTemplate =
        formData.get("templateFile") instanceof File &&
        (formData.get("templateFile") as File).size > 0;
      if (rawUrl && !targetUrl) return { error: "Enter a valid website URL." };
      if (!targetUrl && !hasTemplate) {
        return { error: "Provide a website URL or upload a SEOPress template." };
      }
      const mode = formData.get("mode") === "development" ? "development" : "existing";
      return {
        options: {
          target_url: targetUrl?.toString() ?? "",
          mode,
          keywords: list(formData.get("keywords")),
        },
        websiteUrl: targetUrl?.origin,
      };
    }
    case "one_off_metadata": {
      const pageUrl = parseUrl(String(formData.get("pageUrl") ?? "").trim());
      if (!pageUrl) return { error: "Enter a valid page URL." };
      return {
        options: {
          url: pageUrl.toString(),
          keywords: list(formData.get("keywords")),
          page_context: String(formData.get("pageContext") ?? "").trim(),
        },
        websiteUrl: pageUrl.origin,
      };
    }
    case "schema_generation": {
      const communityUrl = parseUrl(
        String(formData.get("communityUrl") ?? "").trim(),
      );
      if (!communityUrl) return { error: "Enter a valid community URL." };
      const facts: Record<string, unknown> = {
        name: String(formData.get("communityName") ?? "").trim(),
        url: communityUrl.toString(),
        description: String(formData.get("description") ?? "").trim(),
        telephone: String(formData.get("telephone") ?? "").trim(),
        street_address: String(formData.get("streetAddress") ?? "").trim(),
        city: String(formData.get("city") ?? "").trim(),
        region: String(formData.get("region") ?? "").trim(),
        postal_code: String(formData.get("postalCode") ?? "").trim(),
        amenities: list(formData.get("amenities")),
      };
      const petsAllowed = String(formData.get("petsAllowed") ?? "");
      if (petsAllowed === "yes") facts.pets_allowed = true;
      if (petsAllowed === "no") facts.pets_allowed = false;
      const floorPlansRaw = String(formData.get("floorPlans") ?? "").trim();
      if (floorPlansRaw) {
        const plans = floorPlansRaw
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [name, url, bedrooms, bathrooms, squareFeet] = line
              .split("|")
              .map((part) => part.trim());
            const plan: Record<string, unknown> = { name, url };
            if (bedrooms) plan.bedrooms = Number(bedrooms);
            if (bathrooms) plan.bathrooms = Number(bathrooms);
            if (squareFeet) plan.square_feet = Number(squareFeet);
            return plan;
          });
        facts.floor_plans = plans;
      }
      return { options: { facts }, websiteUrl: communityUrl.origin };
    }
    case "llms_txt": {
      const targetUrl = parseUrl(String(formData.get("targetUrl") ?? "").trim());
      if (!targetUrl) return { error: "Enter a valid website URL." };
      return {
        options: {
          target_url: targetUrl.toString(),
          site_name: String(formData.get("siteName") ?? "").trim(),
          description: String(formData.get("description") ?? "").trim(),
        },
        websiteUrl: targetUrl.origin,
      };
    }
    case "local_audit": {
      return { options: {} };
    }
    case "listing_optimization": {
      const listingUrl = parseUrl(String(formData.get("listingUrl") ?? "").trim());
      if (!listingUrl) return { error: "Enter a valid listing URL." };
      return {
        options: {
          listing_url: listingUrl.toString(),
          keywords: list(formData.get("keywords")),
          original_copy: String(formData.get("originalCopy") ?? "").trim(),
        },
      };
    }
    default:
      return { error: "Unknown tool type." };
  }
}

export async function saveClientIntake(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "").trim();
  if (!clientId) throw new Error("Client id is required.");

  const intake = {
    developer_contact: String(formData.get("developerContact") ?? "").trim(),
    main_contact: String(formData.get("mainContact") ?? "").trim(),
    goals: String(formData.get("goals") ?? "").trim(),
    competitors: String(formData.get("competitors") ?? "").trim(),
    target_markets: String(formData.get("targetMarkets") ?? "").trim(),
    avoided_terms: String(formData.get("avoidedTerms") ?? "").trim(),
    differentiators: String(formData.get("differentiators") ?? "").trim(),
    amenities: String(formData.get("amenities") ?? "").trim(),
    renovations: String(formData.get("renovations") ?? "").trim(),
    events_partnerships: String(formData.get("eventsPartnerships") ?? "").trim(),
    content_plans: String(formData.get("contentPlans") ?? "").trim(),
    nap: {
      name: String(formData.get("napName") ?? "").trim(),
      address: String(formData.get("napAddress") ?? "").trim(),
      phone: String(formData.get("napPhone") ?? "").trim(),
      website: String(formData.get("napWebsite") ?? "").trim(),
    },
  };

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) redirect("/login");

  const { error } = await supabase
    .from("clients")
    .update({ intake })
    .eq("id", clientId);
  if (error) throw new Error("The intake answers could not be saved.");

  redirect(`/clients/${clientId}`);
}
