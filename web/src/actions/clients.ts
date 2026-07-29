"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createClient(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!name || !websiteUrl) {
    throw new Error("Client name and website URL are required.");
  }
  try {
    const url = new URL(websiteUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS website URL.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) redirect("/login");

  const { data, error } = await supabase
    .from("clients")
    .insert({
      name,
      website_url: websiteUrl,
      notes: notes || null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error("The client could not be created.");
  }

  redirect(`/clients/${data.id}`);
}
