begin;

-- Shared foundation for standalone SEO tools (keyword research, bulk metadata,
-- one-off writing, schema generation, llms.txt, local audits, and listing
-- optimization). Tool runs mirror the audit queue lifecycle but are claimed
-- independently so they never block or get blocked by crawls.

create type public.tool_type as enum (
  'keyword_research',
  'bulk_metadata',
  'one_off_metadata',
  'schema_generation',
  'llms_txt',
  'local_audit',
  'listing_optimization'
);

create type public.tool_run_status as enum (
  'queued', 'running', 'completed', 'failed', 'cancelled'
);

create type public.tool_item_review as enum (
  'unreviewed', 'approved', 'rejected'
);

-- Structured intake questionnaire answers stored as approved client context.
alter table public.clients
  add column intake jsonb not null default '{}'::jsonb
  check (jsonb_typeof(intake) = 'object');

create table public.tool_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  audit_id uuid references public.audits(id) on delete set null,
  tool_type public.tool_type not null,
  name text not null check (length(trim(name)) between 1 and 200),
  status public.tool_run_status not null default 'queued',
  current_stage text not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  requested_by uuid references public.profiles(id) on delete set null,
  claimed_by text,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'running' and claimed_by is not null and claimed_at is not null)
    or status <> 'running'
  )
);

-- One reviewable unit per row: a keyword, a page's metadata proposal, a JSON-LD
-- document, an llms.txt draft, a checklist entry, or listing copy. Raw model
-- output stays in `output`; staff edits live in `edited_output`; approval is an
-- explicit reviewer action.
create table public.tool_run_items (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references public.tool_runs(id) on delete cascade,
  item_type text not null check (length(trim(item_type)) between 1 and 80),
  stable_key text not null check (length(trim(stable_key)) between 1 and 512),
  position integer not null default 0 check (position >= 0),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object'),
  edited_output jsonb check (edited_output is null or jsonb_typeof(edited_output) = 'object'),
  review_status public.tool_item_review not null default 'unreviewed',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, stable_key)
);

create table public.tool_run_events (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references public.tool_runs(id) on delete cascade,
  event_type text not null check (length(trim(event_type)) between 1 and 80),
  message text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.tool_artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references public.tool_runs(id) on delete cascade,
  kind text not null check (length(trim(kind)) between 1 and 80),
  bucket_id text not null default 'tool-artifacts' check (bucket_id = 'tool-artifacts'),
  object_path text not null check (object_path <> '' and object_path !~ '(^|/)\.\.(/|$)'),
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 bytea check (sha256 is null or octet_length(sha256) = 32),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

create index tool_runs_client_created_idx on public.tool_runs(client_id, created_at desc);
create index tool_runs_audit_idx on public.tool_runs(audit_id) where audit_id is not null;
create index tool_runs_requested_by_idx on public.tool_runs(requested_by);
create index tool_runs_claim_queue_idx on public.tool_runs(status, created_at)
  where status in ('queued', 'running');
create index tool_run_items_run_position_idx on public.tool_run_items(run_id, position);
create index tool_run_items_review_idx on public.tool_run_items(run_id, review_status);
create index tool_run_items_reviewed_by_idx on public.tool_run_items(reviewed_by)
  where reviewed_by is not null;
create index tool_run_events_run_created_idx on public.tool_run_events(run_id, created_at);
create index tool_run_events_actor_idx on public.tool_run_events(actor_id)
  where actor_id is not null;
create index tool_artifacts_run_idx on public.tool_artifacts(run_id);
create index tool_artifacts_created_by_idx on public.tool_artifacts(created_by)
  where created_by is not null;

create trigger tool_runs_set_updated_at before update on public.tool_runs
for each row execute function private.set_updated_at();
create trigger tool_run_items_set_updated_at before update on public.tool_run_items
for each row execute function private.set_updated_at();

create or replace function private.can_access_tool_run(target_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_internal_user()
    and exists (select 1 from public.tool_runs r where r.id = target_run_id);
$$;

create or replace function private.can_access_tool_artifact_path(path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run_id uuid;
begin
  run_id := split_part(path, '/', 1)::uuid;
  return private.can_access_tool_run(run_id);
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function private.can_access_tool_run(uuid) from public, anon;
revoke all on function private.can_access_tool_artifact_path(text) from public, anon;
grant execute on function private.can_access_tool_run(uuid) to authenticated;
grant execute on function private.can_access_tool_artifact_path(text) to authenticated;

alter table public.tool_runs enable row level security;
alter table public.tool_run_items enable row level security;
alter table public.tool_run_events enable row level security;
alter table public.tool_artifacts enable row level security;

create policy tool_runs_internal_read on public.tool_runs
for select to authenticated using (private.is_internal_user());
create policy tool_runs_internal_insert on public.tool_runs
for insert to authenticated with check (private.is_internal_user());
create policy tool_runs_internal_update on public.tool_runs
for update to authenticated using (private.is_internal_user()) with check (private.is_internal_user());
create policy tool_runs_admin_delete on public.tool_runs
for delete to authenticated using (private.is_admin());

create policy tool_run_items_internal_all on public.tool_run_items
for all to authenticated using (private.is_internal_user()) with check (private.is_internal_user());
create policy tool_run_events_internal_read on public.tool_run_events
for select to authenticated using (private.is_internal_user());
create policy tool_run_events_internal_insert on public.tool_run_events
for insert to authenticated with check (private.is_internal_user());
create policy tool_artifacts_internal_all on public.tool_artifacts
for all to authenticated using (private.is_internal_user()) with check (private.is_internal_user());

grant select, insert, delete on public.tool_runs to authenticated;
grant update (
  client_id, audit_id, name, status, current_stage, progress, options,
  summary, requested_by, completed_at, failure_message
)
  on public.tool_runs to authenticated;
grant select, insert, update, delete on public.tool_run_items, public.tool_artifacts
  to authenticated;
grant select, insert on public.tool_run_events to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('tool-artifacts', 'tool-artifacts', false, 26214400)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create policy tool_artifacts_internal_select on storage.objects
for select to authenticated
using (
  bucket_id = 'tool-artifacts'
  and private.can_access_tool_artifact_path(name)
);
create policy tool_artifacts_internal_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'tool-artifacts'
  and private.can_access_tool_artifact_path(name)
);
create policy tool_artifacts_internal_update on storage.objects
for update to authenticated
using (
  bucket_id = 'tool-artifacts'
  and private.can_access_tool_artifact_path(name)
)
with check (
  bucket_id = 'tool-artifacts'
  and private.can_access_tool_artifact_path(name)
);
create policy tool_artifacts_internal_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'tool-artifacts'
  and private.can_access_tool_artifact_path(name)
);

-- Claims one queued or stale tool run. Unlike audits there is no global
-- single-run lock: tool runs are lighter than crawls and may interleave, but
-- FOR UPDATE SKIP LOCKED still guarantees a run is claimed exactly once.
create or replace function private.claim_tool_run(
  worker_id text,
  supported_types public.tool_type[]
)
returns setof public.tool_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  if worker_id is null or length(trim(worker_id)) = 0 then
    raise exception 'worker_id is required';
  end if;
  if supported_types is null or array_length(supported_types, 1) is null then
    raise exception 'supported_types is required';
  end if;

  select id
  into claimed_id
  from public.tool_runs
  where tool_type = any(supported_types)
    and (
      status = 'queued'
      or (status = 'running' and coalesce(heartbeat_at, claimed_at) <= now() - interval '2 minutes')
    )
  order by created_at
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.tool_runs
  set status = 'running',
      claimed_by = worker_id,
      claimed_at = now(),
      heartbeat_at = now(),
      started_at = coalesce(started_at, now()),
      attempt_count = attempt_count + 1,
      failure_message = null
  where id = claimed_id
  returning *;
end;
$$;

create or replace function private.heartbeat_tool_run(target_run_id uuid, worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tool_runs
  set heartbeat_at = now()
  where id = target_run_id
    and status = 'running'
    and claimed_by = worker_id;
  return found;
end;
$$;

comment on function private.claim_tool_run(text, public.tool_type[]) is
'Atomically claims one queued/stale tool run of a supported type for a worker.';
comment on function private.heartbeat_tool_run(uuid, text) is
'Refreshes a tool run claim only when run id and worker id match.';

revoke all on function private.claim_tool_run(text, public.tool_type[]) from public, anon, authenticated;
revoke all on function private.heartbeat_tool_run(uuid, text) from public, anon, authenticated;
grant execute on function private.claim_tool_run(text, public.tool_type[]) to service_role;
grant execute on function private.heartbeat_tool_run(uuid, text) to service_role;

commit;
