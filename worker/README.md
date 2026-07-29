# Audit Worker

The worker is a private, single-concurrency Render service. It claims queued
audits from Supabase Postgres, runs the Screaming Frog Linux CLI, normalizes the
exports, stores findings, and uploads artifacts.

## Required production secrets

- `SUPABASE_DB_URL`
- `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`
- `SEMRUSH_API_KEY`
- `ANTHROPIC_API_KEY`
- `SCREAMING_FROG_LICENSE_B64`

`SCREAMING_FROG_LICENSE_B64` is the base64 encoding of the complete licensed
worker user's `licence.txt` file. It is decoded only at container startup and
must never be committed.

## Optional settings

- `PAGESPEED_API_KEY`
- `WORKER_ID` (default `seo-audit-worker-1`)
- `WORKER_POLL_SECONDS` (default `5`)
- `AUDIT_WORK_ROOT` (default `/tmp/seo-audits`)

## Image

`worker/Dockerfile` installs the official Screaming Frog Ubuntu package and
runs the Python worker under Xvfb. Update the package URL build argument when
upgrading Screaming Frog and verify the CLI export names against the
normalization tests.

No Supabase project is currently linked. The worker cannot start until the
local migrations have been reviewed, applied to an authorized project, and the
required secrets have been configured.
