create index artifacts_created_by_idx on public.artifacts(created_by);
create index audit_events_actor_id_idx on public.audit_events(actor_id);
create index audit_snapshots_created_by_idx on public.audit_snapshots(created_by);
create index audits_requested_by_idx on public.audits(requested_by);
create index share_links_created_by_idx on public.share_links(created_by);
create index task_comments_author_id_idx on public.task_comments(author_id);
create index tasks_created_by_idx on public.tasks(created_by);
create index tasks_finding_id_idx on public.tasks(finding_id);
