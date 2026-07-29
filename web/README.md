# SEO Audit Web

A Next.js App Router workspace for technical SEO audits, internal review, client
reports, and PIN-protected task sharing. It reads live data from Supabase and
shows empty states when a workspace has no clients or audits.

## Scripts

```bash
npm install
npm run dev        # development at http://localhost:3000
npm run lint       # ESLint
npm run typecheck  # TypeScript without emitting
npm run build      # production build
npm start          # serve production build
```

## Data and authentication boundary

Pages access data through the typed `DataProvider` interface in
`src/lib/data/types.ts`. `src/lib/data/index.ts` selects `mock.ts` or the
server-only Supabase adapter based on environment configuration.

Supabase Auth is validated server-side for internal routes. Public share tokens
and PINs are verified through a private database function; only a signed,
short-lived HTTP-only portal session is stored in the browser. Raw tokens and
PINs are never persisted.

Copy `.env.example` to `.env.local` to connect Supabase. Full setup and
deployment instructions are in `../docs/setup-and-deployment.md`.

## Routes

- `/login`, `/dashboard`, `/clients`, `/clients/[clientId]`
- `/audits/new`, `/audits/[auditId]`, `/audits/[auditId]/report`
- `/share/[token]` (public PIN-protected client portal)
