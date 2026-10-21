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
- `GOOGLE_MAPS_API_KEY` enables address geocoding and distance-ranked competitor
  community selection through Google Places. Restrict the key to the Places
  and Geocoding APIs and keep it server-side.
- `WORKER_ID` (default `seo-audit-worker-1`)
- `WORKER_POLL_SECONDS` (default `5`)
- `AUDIT_WORK_ROOT` (default `/tmp/seo-audits`)

## Image

Normal crawls that return HTTP 403 for documents automatically retry once with
the bundled browser HTTP profile before HTML fallback. Both attempts use the
same URL scope and export tabs. The retry is limited to ten minutes, does not
run when HTTP 429 is observed, and is selected only if it recovers more HTML
pages. Failed retries retain the first attempt's exports. `crawl_attempts.json`
and the report's Technical Coverage sheet record the selected profile and counts.
The browser profile respects robots.txt and does not enable JavaScript rendering.

`worker/Dockerfile` installs the official Screaming Frog Ubuntu package and
runs the Python worker under Xvfb. Update the package URL build argument when
upgrading Screaming Frog and verify the CLI export names against the
normalization tests.

No Supabase project is currently linked. The worker cannot start until the
local migrations have been reviewed, applied to an authorized project, and the
required secrets have been configured.
