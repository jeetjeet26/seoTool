# Local Supabase foundation

This directory is intentionally local-only. **Do not run `supabase link`, `supabase db push`, or apply these migrations to any remote project yet.** Review and test them against a disposable local Supabase stack first.

## Contents

- `config.toml` configures local API, Postgres, Studio, Auth, Storage, and seed behavior. Public email signup is disabled.
- `migrations/20260729000100_initial_foundation.sql` creates the application schema, RLS policies, private helper functions, and private artifact bucket.
- `seed.sql` adds obviously fictional records under reserved `.example` URLs. It creates no Auth users, credentials, share tokens, or PINs.

## Schema intent

`auth.users` is the source of internal password identities. A `profiles` row shares the Auth user UUID and carries the authoritative `admin` or `analyst` role. Authorization never reads `user_metadata`.

Clients own audits. Audits own events, findings, tasks, artifacts, and immutable-version snapshots; task comments belong to tasks. Cascades remove audit-owned data, while user references use `ON DELETE SET NULL` to preserve business history. Profiles cascade only when the corresponding Auth user is deleted.

Audit jobs use `queued` and `running` states plus claim/heartbeat fields. `private.claim_audit_job` serializes claims with an advisory transaction lock and refuses to claim another job while a healthy running claim exists. A two-minute stale claim may be reclaimed. `private.heartbeat_audit_job` updates only a matching audit/worker claim. Both functions are granted only to `service_role`.

## RLS and role model

RLS is enabled on every application table in `public`.

- `anon` receives no application-table grants and has no policies.
- An `authenticated` user must have an active `profiles` row with role `admin` or `analyst`.
- Active internal users can work with clients, audits, findings, tasks, comments, artifacts, and snapshots.
- Audit events are append-only through normal authenticated access.
- Destructive client/audit operations and all share-link administration require `admin`.
- Profile provisioning and role changes are intentionally server-side/service-role operations.

The authorization helpers are security-definer functions in the non-exposed `private` schema with fixed empty search paths. Only the small RLS predicate helpers are executable by `authenticated`; privileged job and share-validation functions are service-role only.

## Public share access

There are deliberately no anonymous report or task policies. A browser must not query reports/tasks directly with a raw share token.

Implement public sharing through a server endpoint holding the service-role credential:

1. Accept the raw high-entropy token and PIN over TLS.
2. Call `private.validate_share_access(raw_token, supplied_pin)` on a trusted server connection.
3. If it returns an audit UUID, fetch and shape only the explicitly shareable report/task fields on the server.
4. Return that bounded response; never return the stored hash, service-role credential, or unrestricted database access.

The private validator hashes the supplied token with SHA-256, verifies the PIN with `pgcrypto.crypt`, enforces expiry/revocation, records failures, and locks access for 15 minutes after five failures. Store only SHA-256 token digests and adaptive password hashes (for example bcrypt produced by `crypt(pin, gen_salt('bf'))`). The private schema must remain absent from Supabase API `exposed_schemas`.

## Artifact storage contract

The migration creates one non-public bucket: `audit-artifacts`. Object names must start with the audit UUID:

`<audit-uuid>/<artifact-specific-path>`

Storage policies permit active internal users only when the leading UUID identifies an existing audit. Select, insert, update, and delete are separately covered so SDK upserts can work. Application code should keep the `artifacts.object_path` row synchronized with the Storage object and should use short-lived signed URLs generated server-side when external delivery is necessary. Never make this bucket public.

## Local validation

When the Supabase CLI is installed, use only local commands:

```sh
supabase start
supabase db reset --local
supabase migration list --local
supabase stop
```

Do not authenticate the CLI for this work. Before any eventual remote use, review migration compatibility against that project's Postgres/Supabase versions, test role-specific access, exercise share lockout behavior, and run Supabase database/security advisors.
