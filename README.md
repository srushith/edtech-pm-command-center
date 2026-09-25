# EdTech PM Command Center

Operating system for EdTech Product/Curriculum Managers. Each PM works in their own
workspace; see `CLAUDE.md` for product principles, conventions and build phases.

## Setup

```bash
npm install                    # also generates the Prisma client
cp .env.example .env.local     # then fill in every value (see comments in the file)
npm run db:deploy              # apply migrations to DATABASE_URL
npm run dev                    # http://localhost:3000
```

Sign in with Google as an email in `ALLOWED_EMAILS`, create a workspace, and choose
"Start with demo data" or "Start empty". Invite teammates from Settings.

## Scripts

| Script | What it does |
|---|---|
| `db:migrate` | Create and apply a migration after editing `prisma/schema.prisma` (dev) |
| `db:deploy` | Apply pending migrations (fresh setup, CI, production) |
| `db:reset` | Drop and recreate the database from migrations (destroys all data) |
| `db:generate` | Regenerate the Prisma client into `lib/generated/prisma` |
| `test` | Migrate `DATABASE_URL_TEST`, then run `tests/` against it (wipes that database) |

Demo data is deterministic (fixed anchor date in `lib/domain/time.ts`, seeded PRNG in
`lib/demo/seed.ts`), so every demo workspace is identical. `/data` shows the current
workspace's record counts and live integrity checks.

## Importing from Google Sheets

Import (CSV or Google Sheets) lives at `/import`. For Sheets, in the same Google Cloud
project as sign-in:

1. APIs & Services → Library → enable **Google Sheets API**.
2. OAuth consent screen → Data access → add the scope
   `https://www.googleapis.com/auth/spreadsheets.readonly`.

The app asks each user for that read-only permission only when they choose "Google Sheet".
It's a sensitive scope: fine for test users while the consent screen is in Testing, but
publishing the app to everyone requires Google's verification.

## AI

Owners set the workspace's AI provider (OpenAI, Gemini or Anthropic), API key, model and an
optional monthly request limit in Settings → AI. Without a key, a built-in mock is used. Keys
are encrypted with `ENCRYPTION_KEY` (see `.env.example`) and never sent to the browser. Usage
(requests and tokens) is logged per workspace and shown in Settings; the header shows the
active AI mode.
