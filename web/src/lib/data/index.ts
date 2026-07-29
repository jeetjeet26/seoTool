import { isSupabaseConfigured } from "@/lib/config";

import { emptyData } from "./empty";
import { supabaseData } from "./supabase";

export const data = isSupabaseConfigured ? supabaseData : emptyData;
export type * from "./types";
