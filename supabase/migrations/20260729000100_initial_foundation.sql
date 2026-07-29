begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create type public.app_role as enum ('admin', 'analyst');
create type public.audit_status as enum ('draft', 'queued', 'running', 'completed', 'failed', 'cancelled');
create type public.finding_severity as enum ('info', 'low', 'medium', 'high', 'critical');
create type public.finding_status as enum ('open', 'accepted', 'resolved', 'dismissed');
create type public.task_status as enum ('todo', 'in_progress', 'blocked', 'done', 'cancelled');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  role public.app_role not null default 'analyst',
  is_active boolean not null default true,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

revoke all on function private.handle_new_user() from public, anon, authenticated;

create table public.clients (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  website_url text not null check (website_url ~* '^https?://'),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audits (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  target_url text not null check (target_url ~* '^https?://'),
  target_city text not null check (length(trim(target_city)) between 1 and 160),
  target_region text check (target_region is null or length(trim(target_region)) between 1 and 160),
  page_limit integer not null default 1000 check (page_limit between 1 and 1000),
  run_performance boolean not null default true,
  run_accessibility boolean not null default true,
  status public.audit_status not null default 'draft',
  current_stage text not null default 'pending',
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
  published_at timestamptz,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'running' and claimed_by is not null and claimed_at is not null)
    or status <> 'running'
  )
);

create table public.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  event_type text not null check (length(trim(event_type)) between 1 and 80),
  message text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.findings (
  id uuid primary key default extensions.gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  stable_key text not null check (stable_key ~ '^[a-f0-9]{64}$'),
  category text not null check (length(trim(category)) between 1 and 120),
  rule_key text not null check (length(trim(rule_key)) between 1 and 120),
  title text not null check (length(trim(title)) between 1 and 240),
  description text not null,
  severity public.finding_severity not null,
  status public.finding_status not null default 'open',
  page_url text,
  resource_url text,
  recommendation text not null default '',
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  source_file text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  is_published boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_id, stable_key)
);

create table public.tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  finding_id uuid references public.findings(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 240),
  description text,
  internal_notes text,
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  is_client_visible boolean not null default false,
  assignee_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  published_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_comments (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 10000),
  is_client_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.share_links (
  id uuid primary key default extensions.gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  pin_hash text not null check (length(pin_hash) >= 20),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  last_failed_at timestamptz,
  last_accessed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.artifacts (
  id uuid primary key default extensions.gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  kind text not null check (length(trim(kind)) between 1 and 80),
  bucket_id text not null default 'audit-artifacts' check (bucket_id = 'audit-artifacts'),
  object_path text not null check (object_path <> '' and object_path !~ '(^|/)\.\.(/|$)'),
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 bytea check (sha256 is null or octet_length(sha256) = 32),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

create table public.audit_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (audit_id, version)
);

create index clients_created_by_idx on public.clients(created_by);
create index audits_client_created_idx on public.audits(client_id, created_at desc);
create index audits_claim_queue_idx on public.audits(status, created_at) where status in ('queued', 'running');
create index audit_events_audit_created_idx on public.audit_events(audit_id, created_at);
create index findings_audit_severity_idx on public.findings(audit_id, severity);
create index findings_audit_category_idx on public.findings(audit_id, category);
create index findings_page_url_idx on public.findings(audit_id, page_url);
create index findings_open_idx on public.findings(audit_id, created_at) where status = 'open';
create index tasks_audit_status_idx on public.tasks(audit_id, status);
create index tasks_assignee_status_idx on public.tasks(assignee_id, status) where assignee_id is not null;
create unique index tasks_unique_finding_idx on public.tasks(audit_id, finding_id)
where finding_id is not null;
create index task_comments_task_created_idx on public.task_comments(task_id, created_at);
create index share_links_audit_idx on public.share_links(audit_id);
create index share_links_expiry_idx on public.share_links(expires_at) where revoked_at is null;
create index artifacts_audit_idx on public.artifacts(audit_id);
create index audit_snapshots_audit_created_idx on public.audit_snapshots(audit_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger clients_set_updated_at before update on public.clients
for each row execute function private.set_updated_at();
create trigger audits_set_updated_at before update on public.audits
for each row execute function private.set_updated_at();
create trigger findings_set_updated_at before update on public.findings
for each row execute function private.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function private.set_updated_at();
create trigger task_comments_set_updated_at before update on public.task_comments
for each row execute function private.set_updated_at();
create trigger share_links_set_updated_at before update on public.share_links
for each row execute function private.set_updated_at();

create or replace function private.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.role in ('admin', 'analyst')
  );
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.role = 'admin'
  );
$$;

create or replace function private.can_access_audit(target_audit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_internal_user()
    and exists (select 1 from public.audits a where a.id = target_audit_id);
$$;

create or replace function private.can_access_artifact_path(path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  audit_id uuid;
begin
  audit_id := split_part(path, '/', 1)::uuid;
  return private.can_access_audit(audit_id);
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.is_internal_user() from public, anon;
revoke all on function private.is_admin() from public, anon;
revoke all on function private.can_access_audit(uuid) from public, anon;
revoke all on function private.can_access_artifact_path(text) from public, anon;
grant execute on function private.is_internal_user() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.can_access_audit(uuid) to authenticated;
grant execute on function private.can_access_artifact_path(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.audits enable row level security;
alter table public.audit_events enable row level security;
alter table public.findings enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.share_links enable row level security;
alter table public.artifacts enable row level security;
alter table public.audit_snapshots enable row level security;

create policy profiles_internal_read on public.profiles
for select to authenticated using (private.is_internal_user());

create policy clients_internal_read on public.clients
for select to authenticated using (private.is_internal_user());
create policy clients_internal_insert on public.clients
for insert to authenticated with check (private.is_internal_user());
create policy clients_internal_update on public.clients
for update to authenticated using (private.is_internal_user()) with check (private.is_internal_user());
create policy clients_admin_delete on public.clients
for delete to authenticated using (private.is_admin());

create policy audits_internal_read on public.audits
for select to authenticated using (private.is_internal_user());
create policy audits_internal_insert on public.audits
for insert to authenticated with check (private.is_internal_user());
create policy audits_internal_update on public.audits
for update to authenticated using (private.is_internal_user()) with check (private.is_internal_user());
create policy audits_admin_delete on public.audits
for delete to authenticated using (private.is_admin());

create policy audit_events_internal_read on public.audit_events
for select to authenticated using (private.is_internal_user());
create policy audit_events_internal_insert on public.audit_events
for insert to authenticated with check (private.is_internal_user());

create policy findings_internal_all on public.findings
for all to authenticated using (private.is_internal_user()) with check (private.is_internal_user());
create policy tasks_internal_all on public.tasks
for all to authenticated using (private.is_internal_user()) with check (private.is_internal_user());
create policy task_comments_internal_all on public.task_comments
for all to authenticated using (private.is_internal_user()) with check (private.is_internal_user());
create policy artifacts_internal_all on public.artifacts
for all to authenticated using (private.is_internal_user()) with check (private.is_internal_user());
create policy audit_snapshots_internal_all on public.audit_snapshots
for all to authenticated using (private.is_internal_user()) with check (private.is_internal_user());
create policy share_links_admin_all on public.share_links
for all to authenticated using (private.is_admin()) with check (private.is_admin());

revoke all on all tables in schema public from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.clients, public.findings,
  public.tasks, public.task_comments, public.artifacts, public.audit_snapshots
  to authenticated;
grant select, insert, delete on public.audits to authenticated;
grant update (
  client_id, name, target_url, target_city, target_region, page_limit,
  run_performance, run_accessibility, status, current_stage, progress, options,
  summary, requested_by, completed_at, published_at, failure_message
)
  on public.audits to authenticated;
grant select, insert on public.audit_events to authenticated;
grant select, insert, update, delete on public.share_links to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('audit-artifacts', 'audit-artifacts', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create policy audit_artifacts_internal_select on storage.objects
for select to authenticated
using (
  bucket_id = 'audit-artifacts'
  and private.can_access_artifact_path(name)
);
create policy audit_artifacts_internal_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'audit-artifacts'
  and private.can_access_artifact_path(name)
);
create policy audit_artifacts_internal_update on storage.objects
for update to authenticated
using (
  bucket_id = 'audit-artifacts'
  and private.can_access_artifact_path(name)
)
with check (
  bucket_id = 'audit-artifacts'
  and private.can_access_artifact_path(name)
);
create policy audit_artifacts_internal_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'audit-artifacts'
  and private.can_access_artifact_path(name)
);

create or replace function private.validate_share_access(raw_token text, supplied_pin text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.share_links%rowtype;
begin
  if raw_token is null or raw_token = '' or supplied_pin is null or supplied_pin = '' then
    return null;
  end if;

  select *
  into link
  from public.share_links
  where token_hash = extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256')
  for update;

  if not found
    or link.revoked_at is not null
    or link.expires_at <= now()
    or (link.locked_until is not null and link.locked_until > now()) then
    return null;
  end if;

  if extensions.crypt(supplied_pin, link.pin_hash) <> link.pin_hash then
    update public.share_links
    set failed_attempts = failed_attempts + 1,
        last_failed_at = now(),
        locked_until = case
          when failed_attempts + 1 >= 5 then now() + interval '15 minutes'
          else locked_until
        end
    where id = link.id;
    return null;
  end if;

  update public.share_links
  set failed_attempts = 0,
      locked_until = null,
      last_accessed_at = now()
  where id = link.id;

  return link.audit_id;
end;
$$;

comment on function private.validate_share_access(text, text) is
'Server-only token and PIN validator. Keep private schema out of exposed API schemas and call only from trusted service-role code.';

revoke all on function private.validate_share_access(text, text) from public, anon, authenticated;
grant execute on function private.validate_share_access(text, text) to service_role;

create or replace function private.create_share_link(
  target_audit_id uuid,
  raw_token text,
  raw_pin text,
  target_expires_at timestamptz,
  actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
begin
  if not exists (
    select 1
    from public.profiles
    where id = actor_id and is_active and role = 'admin'
  ) then
    raise exception 'admin access required';
  end if;
  if length(raw_token) < 43 or length(raw_pin) < 4 or length(raw_pin) > 128 then
    raise exception 'invalid share credentials';
  end if;
  if target_expires_at <= now() then
    raise exception 'expiry must be in the future';
  end if;

  insert into public.share_links (
    audit_id, token_hash, pin_hash, expires_at, created_by
  )
  values (
    target_audit_id,
    extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'),
    extensions.crypt(raw_pin, extensions.gen_salt('bf', 12)),
    target_expires_at,
    actor_id
  )
  returning id into created_id;

  update public.audits
  set published_at = coalesce(published_at, now())
  where id = target_audit_id and status = 'completed';

  return created_id;
end;
$$;

comment on function private.create_share_link(uuid, text, text, timestamptz, uuid) is
'Server-only share link creator. Returns the link id; raw token and PIN are never stored.';

revoke all on function private.create_share_link(uuid, text, text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function private.create_share_link(uuid, text, text, timestamptz, uuid)
  to service_role;

create or replace function private.claim_audit_job(worker_id text)
returns setof public.audits
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

  perform pg_catalog.pg_advisory_xact_lock(7349274101);

  if exists (
    select 1
    from public.audits
    where status = 'running'
      and heartbeat_at > now() - interval '2 minutes'
  ) then
    return;
  end if;

  select id
  into claimed_id
  from public.audits
  where status = 'queued'
     or (status = 'running' and coalesce(heartbeat_at, claimed_at) <= now() - interval '2 minutes')
  order by created_at
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.audits
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

create or replace function private.heartbeat_audit_job(target_audit_id uuid, worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.audits
  set heartbeat_at = now()
  where id = target_audit_id
    and status = 'running'
    and claimed_by = worker_id;
  return found;
end;
$$;

comment on function private.claim_audit_job(text) is
'Atomically claims one queued/stale audit while enforcing a single active worker globally.';
comment on function private.heartbeat_audit_job(uuid, text) is
'Refreshes a claim only when audit id and worker id match.';

revoke all on function private.claim_audit_job(text) from public, anon, authenticated;
revoke all on function private.heartbeat_audit_job(uuid, text) from public, anon, authenticated;
grant execute on function private.claim_audit_job(text) to service_role;
grant execute on function private.heartbeat_audit_job(uuid, text) to service_role;

commit;
