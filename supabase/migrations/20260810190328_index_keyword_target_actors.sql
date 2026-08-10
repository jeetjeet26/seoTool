create index keyword_targets_approved_by_idx
  on public.keyword_targets (approved_by)
  where approved_by is not null;

create index keyword_target_events_actor_idx
  on public.keyword_target_events (actor_id)
  where actor_id is not null;
