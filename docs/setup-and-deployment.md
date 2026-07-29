# Setup and deployment

No remote Supabase project is linked by this repository. The app stays in mock
mode until environment variables are supplied.

## Local UI

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Supabase configuration is required for authentication and workspace data.
Before the first client or audit is created, the application displays empty
states and zero-valued metrics.

## Local Supabase

Docker Desktop and the Supabase CLI are required:

```bash
supabase start
supabase db reset
supabase status
```

Copy the local API URL and publishable key into `web/.env.local`. Set
`SUPABASE_DB_URL` to the local Postgres URL and generate a portal signing secret:

```bash
openssl rand -base64 48
```

Create internal users in Supabase Auth. New users receive an `analyst` profile
automatically. Promote the first administrator in SQL:

```sql
update public.profiles
set role = 'admin'
where id = '<auth-user-id>';
```

The worker uses the root `.env` values and runs with:

```bash
source .venv/bin/activate
python -m worker.main
```

Local Screaming Frog must be licensed. The hosted worker uses the Linux
installation and licence secret in its container.

## Production

1. Create a Supabase project and apply `supabase/migrations/`.
2. Create the first Auth user and promote it to `admin`.
3. Deploy `web/` to Vercel.
4. Configure Vercel with:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_DB_URL` (Supabase transaction pooler connection string)
   - `SHARE_SESSION_SECRET`
5. Create the Render worker from `render.yaml`.
6. Configure its Supabase, Semrush, Anthropic, PageSpeed, and Screaming Frog
   licence secrets.

Do not expose `SUPABASE_DB_URL`, the service-role key, API keys, or licence
material through `NEXT_PUBLIC_*` variables.

## Verification

```bash
source .venv/bin/activate
python -m unittest discover -s tests -v

cd web
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
```

The Docker image still requires a running Docker daemon for a full local build.
