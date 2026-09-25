# EdTech PM Command Center

Operating system for an EdTech Product/Curriculum Manager. See `CLAUDE.md` for product principles and build phases.

## Setup

```bash
npm install            # also generates the Prisma client
cp .env.example .env   # SQLite at prisma/dev.db
npm run db:reset       # create tables + load deterministic seed
npm run dev            # http://localhost:3000/data
```

## Scripts

| Script | What it does |
|---|---|
| `db:push` | Sync `prisma/schema.prisma` to the database |
| `db:seed` | Clear all tables and load the deterministic mock dataset |
| `db:reset` | `db:push` then `db:seed` |
| `db:generate` | Regenerate the Prisma client into `lib/generated/prisma` |

The seed is anchored to a fixed date (`lib/domain/time.ts`) and a seeded PRNG, so every run produces identical data. `/data` shows record counts and live integrity checks.
