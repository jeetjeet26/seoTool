create type public.keyword_target_status as enum (
  'proposed', 'approved', 'rejected', 'paused', 'retired'
);

create type public.keyword_target_role as enum ('primary', 'secondary');

create table public.keyword_targets (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  keyword text not null check (length(trim(keyword)) between 1 and 300),
  normalized_keyword text generated always as (
    lower(regexp_replace(trim(keyword), '\s+', ' ', 'g'))
  ) stored,
  canonical_url text not null check (canonical_url ~* '^https?://'),
  role public.keyword_target_role not null default 'primary',
  status public.keyword_target_status not null default 'proposed',
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  source text,
  rationale text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'approved' and approved_at is not null)
    or status <> 'approved'
  )
);

create unique index keyword_targets_active_keyword_idx
  on public.keyword_targets (client_id, normalized_keyword)
  where status in ('approved', 'paused');
create unique index keyword_targets_primary_page_idx
  on public.keyword_targets (client_id, canonical_url)
  where role = 'primary' and status = 'approved';
create index keyword_targets_client_status_idx
  on public.keyword_targets (client_id, status, canonical_url);

create table public.keyword_target_events (
  id uuid primary key default extensions.gen_random_uuid(),
  target_id uuid not null references public.keyword_targets(id) on delete cascade,
  event_type text not null check (length(trim(event_type)) between 1 and 80),
  previous_value jsonb not null default '{}'::jsonb,
  next_value jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index keyword_target_events_target_created_idx
  on public.keyword_target_events (target_id, created_at desc);

create trigger keyword_targets_set_updated_at
before update on public.keyword_targets
for each row execute function private.set_updated_at();

alter table public.keyword_targets enable row level security;
alter table public.keyword_target_events enable row level security;

create policy keyword_targets_internal_all on public.keyword_targets
for all to authenticated
using (private.is_internal_user())
with check (private.is_internal_user());

create policy keyword_target_events_internal_all on public.keyword_target_events
for all to authenticated
using (private.is_internal_user())
with check (private.is_internal_user());

grant select, insert, update, delete on public.keyword_targets to authenticated;
grant select, insert on public.keyword_target_events to authenticated;
revoke all on public.keyword_targets, public.keyword_target_events from anon;
