"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseOnboarding } from "@/lib/onboarding";

export async function saveOnboarding(_state: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const clientId = String(formData.get("clientId") ?? "");
  const updatedAt = String(formData.get("updatedAt") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !updatedAt) return { error: "Invalid client. Reload this page and try again." };
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { error: "Your session expired. Sign in and try again." };
  const { data: profile } = await supabase.from("profiles").select("role,is_active").eq("id", auth.user.id).maybeSingle();
  if (!profile?.is_active || !["admin", "analyst"].includes(profile.role)) return { error: "You do not have permission to edit onboarding." };
  let onboarding;
  try { onboarding = parseOnboarding(formData); } catch (error) { return { error: error instanceof Error ? error.message : "Check your answers and try again." }; }
  for (const [, entry] of formData) if (typeof entry !== "string" || entry.length > 6000) return { error: "Please keep each answer under 6,000 characters." };
  const { data: client, error: readError } = await supabase.from("clients").select("intake,updated_at").eq("id", clientId).maybeSingle();
  if (readError || !client) return { error: "The client could not be loaded." };
  if (client.updated_at !== updatedAt) return { error: "Someone updated this client while you were editing. Copy your unsaved answers, then reload to see their changes." };
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
    property_name: String(formData.get("propertyName") ?? "").trim(),
    vertical: String(formData.get("vertical") ?? "").trim(),
    title_style_guide: String(formData.get("titleStyleGuide") ?? "").trim(),
    fair_housing_enabled: formData.get("fairHousingEnabled") === "on",
    semrush_project_id: String(formData.get("semrushProjectId") ?? "")
      .trim()
      .replace(/\D/g, ""),
    nap: {
      name: String(formData.get("napName") ?? "").trim(),
      address: String(formData.get("napAddress") ?? "").trim(),
      phone: String(formData.get("napPhone") ?? "").trim(),
      website: String(formData.get("napWebsite") ?? "").trim(),
    },
  };
  const { data: saved, error } = await supabase.from("clients")
    .update({ intake: { ...client.intake, ...intake, onboarding, onboarding_updated_by: auth.user.id } })
    .eq("id", clientId).eq("updated_at", updatedAt).select("id").maybeSingle();
  if (error || !saved) return { error: "The client changed or could not be saved. Reload and try again." };
  revalidatePath("/clients"); revalidatePath(`/clients/${clientId}`); revalidatePath(`/clients/${clientId}/intake`);
  redirect(`/clients/${clientId}/intake?saved=1`);
}
