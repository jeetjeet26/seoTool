-- Defense in depth: Supabase default privileges grant table access to anon.
-- RLS already blocks every row, but the anon role has no business touching
-- tool tables at all, matching the initial foundation's stance.
revoke all on public.tool_runs, public.tool_run_items, public.tool_run_events,
  public.tool_artifacts from anon;
