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


## Report editing chatbot

Open any completed audit report and choose **Edit report with AI**. The panel
always displays the selected report name, site URL, and audit ID. It uses
`gpt-5.6-terra` to apply changes across stored report content, including alt
text, keywords, metadata, copy, summaries, and new or existing findings. Paste
up to 100,000 characters or attach a `.md` / `.txt` review; oversized input is
rejected without truncation. One request supports up to 500 precise edits. Highlight
report text to include it in a request. Ambiguous requests prompt a clarification.

Configure `OPENAI_API_KEY` and `SUPABASE_DB_URL` on the **web server**, alongside
the existing Supabase public configuration. Never use a `NEXT_PUBLIC_` variable
for the OpenAI key. The API requires a signed-in, active internal admin or analyst
and follows the application's existing internal staff access policy. No database
migration is needed. Chat messages and reversible edit snapshots use audit_events.

Deploy both the web app and the updated Python worker. Edits appear immediately
on screen and in the shared report; the worker refreshes private CSV/Excel
artifacts without a crawl. Older downloads are labeled while regeneration is
pending. The worker retries failed export generation up to three times. A new
edit or undo queues another attempt. PDF uses the current report's print view.
Approved client-wide keyword targets and task/publication settings are managed
by their existing controls; chat edits are scoped to the selected report.

The history includes before/after changes and **Undo this edit**. Undo refuses
to overwrite subsequent content changes; undo newer edits first. A revision
check and atomic transaction prevent partial saves and stale report writes.
Repeated requests reuse a request ID so a lost response cannot duplicate an edit.

Requests to keep only selected recommendation pages use a single `retain`
operation with exact URLs. The server preserves the selected rows in full,
including unchanged headings, and removes the other rows from every content
section. Large original objects use server-generated SHA-256 references instead
of requiring the model to copy crawl text. References are checked against the
snapshot, and an invalid plan gets one validation-guided retry before saving.

Validation: `npm run test:report-chat` (Node 22.18+), `npm run typecheck`,
`npm run lint`, and `npm run build`. Run Python export tests from the repository
root with `.venv/bin/python -m unittest tests.test_exports tests.test_export_profiles tests.test_report_chat_exports`.

New technical findings are saved with analyst provenance and included in report
counts and regenerated downloads. Account-lead notes preserve document-only
instructions. Expand affected URLs to read each finding's evidence and recommendation.
The planner has no live-site or Semrush lookup tool: conditional verification stays
pending, and new keywords awaiting metrics show Pending rather than measured zero.
Tests mock model HTTP and database queries; live model/database behavior must be
verified in the deployed environment.
