export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

export const isShareBackendConfigured = Boolean(
  process.env.SUPABASE_DB_URL && process.env.SHARE_SESSION_SECRET,
);
