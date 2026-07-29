# SEO Audit Platform Architecture

## Runtime topology

The product is split into three trust and runtime boundaries:

1. **Next.js web application (Vercel)**
   - Internal password authentication through Supabase Auth.
   - Client, audit, finding, report, and task interfaces.
   - Server-side creation of audits and validation of client share links.
   - Never receives the Supabase service-role key in browser code.

2. **Supabase**
   - Postgres is the source of truth for audits, findings, tasks, and history.
   - Auth manages internal users.
   - Private Storage holds crawl exports, CSV, Excel, PDF, and attachments.
   - Row Level Security protects every table exposed through the Data API.

3. **Python worker (Render)**
   - Claims queued audit jobs using a direct pooled Postgres connection.
   - Runs the licensed Screaming Frog Linux CLI in headless mode.
   - Calls Semrush and Anthropic from the trusted server environment.
   - Normalizes crawl output and uploads artifacts before deleting local files.

## Audit lifecycle

`queued → crawling → analyzing → review_ready → published`

An audit may also enter `failed` or `cancelled`. Each stage writes an append-only
event and progress update. A failed audit must never be represented as a
successful empty report.

The first production worker processes one audit at a time. Every job gets an
isolated directory under `AUDIT_WORK_ROOT/<audit-id>`. Job retries are
idempotent and replace findings for the same attempt transactionally.

## Finding contract

Every issue occurrence is stored as a normalized finding:

- Stable identifier
- Category and issue type
- Severity
- Affected page URL
- Affected resource URL, when applicable
- Evidence and source export
- Recommended fix
- Review and publication state
- First-seen, last-seen, resolved, and regression metadata

The web report uses structured findings as its source of truth. CSV, Excel, and
PDF are generated outputs, not primary storage.

## Public client access

Client links are bearer URLs with at least 256 bits of random entropy. Only a
SHA-256 hash of the token is stored. A separately hashed PIN is required before
a short-lived, HTTP-only portal session is issued.

Public access is server-mediated. The browser never queries internal Supabase
tables with the raw token. Links support expiry, revocation, regeneration,
attempt throttling, and access auditing.

Only explicitly published findings, tasks, comments, and artifacts may be
returned to the client portal. Internal notes and suppressed findings remain
inaccessible.

## Deployment

- `web/` deploys to Vercel.
- `worker/` deploys as a private Render background worker.
- Supabase remains unlinked until project credentials are provided and remote
  changes are explicitly authorized.
- Screaming Frog licence material is injected as a secret at worker startup and
  is never committed or baked into an image.
