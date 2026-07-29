# Security Model

## Trust boundaries

- Browser code receives only the Supabase project URL and publishable key.
- The Supabase service-role key is restricted to Vercel server code and the
  Render worker.
- The direct Postgres connection string is restricted to the worker.
- Semrush, Anthropic, PageSpeed, and Screaming Frog licence credentials are
  worker-only secrets.

## Database and Storage

- Row Level Security is enabled on every table in an exposed schema.
- Authorization roles are stored in trusted profile/app metadata, never
  user-editable user metadata.
- Internal artifacts use a private Storage bucket and short-lived signed URLs.
- Views must use `security_invoker` or remain outside exposed schemas.
- Security-definer functions live in a private schema with explicit
  `search_path`, ownership, and execute grants.

## Client share links

- Generate at least 32 cryptographically random bytes for each token.
- Store only a SHA-256 token hash.
- Hash the independent client PIN with a password hashing function.
- Apply expiry, revocation, failed-attempt limits, temporary lockout, and access
  logging.
- After token and PIN validation, issue a short-lived HTTP-only, secure,
  same-site portal session. Do not keep the PIN in browser storage.
- Public routes return only explicitly published records.

## Crawl target safety

Website URLs are untrusted network destinations. Before queueing an audit:

- Allow only HTTP and HTTPS.
- Reject embedded credentials and nonstandard ports.
- Resolve DNS and reject loopback, private, link-local, reserved, multicast, and
  metadata-service addresses.
- Revalidate before starting the crawl.
- Enforce outbound worker firewall rules because DNS rebinding can occur after
  application validation.
- Limit page count, crawl duration, response size, redirect depth, and
  concurrency.

## Operational controls

- Never mark an audit successful unless required crawl exports exist and parse.
- Use isolated per-audit directories and delete them after artifact upload.
- Redact credentials, authorization headers, tokens, PINs, and connection
  strings from logs.
- Record immutable audit events for job claims, retries, publication, share-link
  changes, and artifact access.
