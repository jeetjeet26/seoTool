alter table public.clients
add column name_key text generated always as (lower(btrim(name))) stored;

create unique index clients_name_key_idx on public.clients(name_key);
