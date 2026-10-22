-- Viewing a legacy publication must not recreate revoked/deleted access.
create or replace function private.publish_report(
  target_audit_id uuid,
  raw_token text,
  raw_pin text,
  target_expires_at timestamptz,
  actor_id uuid
)
returns table(share_token text, share_pin text, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_status public.audit_status;
  audit_published_at timestamptz;
  saved_credentials bytea;
  decoded_credentials jsonb;
  encryption_key text;
  existing_link_id uuid;
  publication_revoked_at timestamptz;
begin
  if not exists (
    select 1 from public.profiles
    where id = actor_id and is_active and role = 'admin'
  ) then
    raise exception 'admin access required';
  end if;

  -- Serializes repeated/double-click/concurrent requests for this audit.
  select a.status, a.published_at into audit_status, audit_published_at
  from public.audits a where a.id = target_audit_id for update;
  if not found or audit_status <> 'completed' then
    raise exception 'completed report required';
  end if;

  select k.encryption_key into encryption_key from private.report_publication_key k where id;
  select p.credentials_ciphertext, s.revoked_at
    into saved_credentials, publication_revoked_at
  from private.report_publications p
  join public.share_links s on s.id = p.share_link_id
  where p.audit_id = target_audit_id;
  if found then
    if publication_revoked_at is not null then
      raise exception 'publication revoked';
    end if;
    decoded_credentials := extensions.pgp_sym_decrypt(saved_credentials, encryption_key)::jsonb;
    return query select decoded_credentials->>'token', decoded_credentials->>'pin', true;
    return;
  end if;

  -- Older links have only hashes. Preserve them even when the original URL/PIN
  -- has not yet been recovered for display; never create a replacement silently.
  select s.id into existing_link_id from public.share_links s
  where s.audit_id = target_audit_id and s.revoked_at is null
  order by s.created_at, s.id limit 1;
  if found then
    update public.audits set published_at = coalesce(published_at, now())
    where id = target_audit_id and published_at is null;
    return query select null::text, null::text, true;
    return;
  end if;

  if audit_published_at is not null then
    raise exception 'existing publication unavailable; explicit access recovery required';
  end if;

  existing_link_id := private.create_share_link(
    target_audit_id, raw_token, raw_pin, target_expires_at, actor_id
  );
  insert into private.report_publications(audit_id, share_link_id, credentials_ciphertext)
  values(target_audit_id, existing_link_id,
    extensions.pgp_sym_encrypt(jsonb_build_object('token',raw_token,'pin',raw_pin)::text, encryption_key, 'cipher-algo=aes256'));
  return query select raw_token, raw_pin, false;
end;
$$;
revoke all on function private.publish_report(uuid,text,text,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function private.publish_report(uuid,text,text,timestamptz,uuid) to service_role;

