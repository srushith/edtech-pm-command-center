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
