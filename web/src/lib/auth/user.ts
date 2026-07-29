import "server-only";

import { cache } from "react";

import { isSupabaseConfigured } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface CurrentProfile {
  id: string;
  displayName: string;
  role: "admin" | "analyst";
}

export const getCurrentProfile = cache(
  async (): Promise<CurrentProfile | null> => {
    if (!isSupabaseConfigured) return null;

    const supabase = await createSupabaseServerClient();
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();
    const userId = claimsData?.claims?.sub;
    if (claimsError || !userId) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("id,display_name,role")
      .eq("id", userId)
      .single();
    if (error || !data) return null;

    return {
      id: data.id,
      displayName: data.display_name,
      role: data.role,
    };
  },
);
