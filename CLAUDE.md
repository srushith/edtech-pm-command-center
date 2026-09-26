# EdTech PM Command Center

An internal operating system for EdTech Product/Curriculum Managers running many
courses, cohorts, instructors, SMEs and learner experiences. Multiple PMs use it, each
in their own workspace(s) of courses; teammates join by invite with a role.
This is an operational PM tool, NOT a BI dashboard. Optimize for decision speed:
the PM should know what is healthy, broken, changed, at risk, and what to do next
within 30 seconds.

## Core product principle
Every signal follows: Metric -> Signal -> Evidence -> Root Cause -> Action.
- Never show a bare number. Show change vs previous period, the cause, and a next action.
- Every important item has an action button (Review recording, Contact instructor,
  Escalate to Ops, Assign owner, Mark resolved, etc.).
- AI output is always labeled "AI Insight" (purple) with a "View evidence" link to
  the underlying records. Never present AI conclusions as fact.

## Stack (all free / open source)
- Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- Recharts for charts, lucide-react for icons, cmdk (shadcn Command) for the palette
- Prisma ORM with PostgreSQL (Neon free tier), schema changes via `prisma migrate`
- Auth.js (next-auth v5) with Google sign-in, JWT sessions, Prisma adapter
- No paid services (no email sending: invites are pending records). AI runs through `lib/ai/provider.ts` with a single
  interface so a real provider can be plugged in later.

## Design rules
- Dark-first, light mode optional. Thin borders, dense but readable, strong type.
- Color is for status only: green healthy, yellow attention, red critical,
  blue info/active, purple AI insight. No decorative gradients or colorful cards.
- Feel: Linear / Vercel / Bloomberg density. Keyboard-first (⌘K, shortcuts).
- Home hierarchy: attention -> what changed -> risk -> what's next -> portfolio -> analytics.

## Data model (see prisma/schema.prisma)
Accounts: User, Account (Auth.js), Workspace, Membership (OWNER | EDITOR | VIEWER), Invite.
Domain: Course, Cohort, Instructor, SME, Module, Session, LearnerFeedback, Issue, Project,
Launch, plus ModuleVersion, ChecklistItem, ActivityEvent (for "What changed").
Every domain model has `workspaceId` and `isDemo`. Required parent links are composite
foreign keys `[parentId, workspaceId]`, so the database rejects cross-workspace children;
optional links are checked in lib/data and by /data's "Links stay inside the workspace".
Demo data ("Start with demo data", `lib/demo/seed.ts`): 10 cohorts across 8 courses,
20+ instructors, 30+ SMEs, 50+ sessions, 100+ feedback records, 20+ issues, 10+ modules,
5+ launches. It must be deterministic and internally consistent (attendance <= learners,
feedback counts plausible for cohort size, ratings match feedback sentiment).
Courses: Agentic AI (US), Transformative GenAI (India), AI Engineering, PM, TPM, EM, SWE, FDE.

## Sidebar sections (main nav, in this order)
1. Command Center `/`
2. Cohorts `/cohorts`
3. Courses `/courses`
4. Curriculum `/curriculum`
5. Instructor / SME Hub `/talent`
6. Class Health `/class-health`
7. Learner Voice `/learner-voice`
8. Launches `/launches`
9. Projects & Capstones `/projects`
10. Operations `/operations`
11. AI Insights `/ai-insights`

Data Integrity (`/data`) and Settings (`/settings`, with `/settings/trash`) are not in the main nav. They live in
the sidebar footer and in ⌘K. The sidebar header is the workspace switcher.
`lib/nav.ts` is the single source for these lists. Outside the dashboard: `/signin`, `/onboarding`.

## Conventions
- Feature folders under `app/(dashboard)/<section>`; shared UI in `components/`.
- Data access only through `lib/data/*` functions, never directly in components.
- Workspaces and roles (non-negotiable):
  - Every page and server action gets its context from `requireWorkspace()` (`lib/auth/session.ts`);
    `proxy.ts` is only an optimistic cookie check, never the security boundary.
  - Every `lib/data` function takes a `WorkspaceContext` and reads/writes domain models only
    through `scopedDb(ctx)` (`lib/data/scoped.ts`): it filters by workspace, stamps creates, and
    blocks writes for viewers. Use flat inputs (no nested writes); no raw SQL on domain data.
  - Workspace/member/invite functions live in `lib/data/workspaces.ts` and check roles explicitly
    (`requireRole`). Owner: settings, members, invites, clear demo data. Editor: edit records.
    Viewer: read only. A workspace always keeps at least one owner.
  - Sign-in is invite-only: `ALLOWED_EMAILS` admins, existing members, or a pending invite.
  - The current workspace is the `cc-workspace` cookie, validated against memberships.
    Switching workspaces drops URL filters (codes belong to a workspace).
  - Any new data function needs a test in `tests/tenancy.test.ts` proving another workspace's
    member can't read or change its records.
- Record writes (create/edit) go through `saveRecord()` in `lib/data/records.ts`, never ad-hoc Prisma:
  - Each type is defined once in `lib/records/<type>.ts`: zod schema (form strings in, typed
    values out), form fields, and `checks` (cross-field/cross-record rules). The same schema and
    checks run in the browser for instant errors and on the server against fresh workspace data.
  - Server-only rules (uniqueness, existing children that constrain an edit) live in the type's
    handler in `lib/data/records.ts`, as do derived values (ratings, cohort status, checklists).
  - Every save logs an ActivityEvent (created / updated / status_changed) in the same transaction.
  - Derived fields are never form inputs: sentiment, learnerId, issue code, cohort status, module
    order, instructor rating, and session rating once the session has feedback.
  - "Now" is the wall clock for user rows and DEMO_TODAY for demo rows (`nowFor` in lib/domain/time.ts).
- Deletes are soft (`lib/data/trash.ts`), never ad-hoc Prisma deletes on domain rows:
  - `deleteRecords()` moves a record and everything that requires it to Trash as one TrashBatch
    (`deletedAt` + `trashBatchId`), clears optional links to it (remembered for restore), recomputes
    derived values and logs a `deleted` ActivityEvent. A preview lists what goes; if anything else
    goes, the user types the record's name (the count for bulk). Instructors with sessions can't be
    deleted: offer Mark inactive.
  - `scopedDb` hides trashed rows from every read and write. A query sees them only by naming
    `deletedAt` in its top-level `where` (`withTrash` / `onlyTrash`): trash.ts, and uniqueness/numbering
    checks (codes and emails stay reserved while in Trash). Nested `_count`/to-many reads need
    `where: { deletedAt: null }` by hand. A live row never has a trashed required parent.
  - Editors delete; the deleter can Undo for 2 minutes. Owners restore, delete forever or empty the
    Trash (`/settings/trash`). Batches are purged after 30 days, lazily (no cron). Every step logs.
  - New domain models get `deletedAt`/`trashBatchId`, an entry in SOFT_DELETE_MODELS and in the
    trash.ts link maps, and new record types a Delete in their table.
- Imports (`lib/data/imports.ts`) validate every row with `validateRecord` (the Add form's rules)
  and write with `persistRecord` in one transaction; never a separate import-only schema.
  Rows match existing records by name (modules: title within course); a code/email belonging to
  another record makes the row invalid rather than guessed. Blank cells keep existing values.
  Imports never delete. A linked sheet's rows remember their record (ImportLink); a row whose
  record was deleted in the app is skipped ("deleted in app"), even after purge. Sync uses the
  clicking user's own Google grant; refresh tokens are encrypted at rest (`lib/google/crypto.ts`).
- AI goes through `getAIProvider(ctx)` in `lib/ai/provider.ts` only: it returns the workspace's
  real provider when an owner set a key, the mock when none is set, or null when AI is off
  (monthly limit reached, CC_AI=off, key unreadable). It logs every real request (feature,
  tokens) to AIUsageEvent and enforces the limit, so features never log or check limits
  themselves. New AI features add a method to the AIProvider interface, implement it in
  lib/ai (mock + real via a JSON request), and must work fully when the provider is null or
  throws AIUnavailableError. AI output is shown as a labelled "AI Insight" with its evidence and
  must be accepted by the user. `tests/ai.test.ts` fails if anything outside lib/ai reaches a
  provider, the mock or a provider SDK directly.
- Secrets at rest use `lib/crypto.ts` (AES-256-GCM, ENCRYPTION_KEY, bound to a purpose). API keys
  are never returned to the browser: views carry only a masked last-4. Client components must not
  import lib/crypto, lib/ai/provider(s) or lib/data/ai-settings (a test checks this).
- Secrets only in `.env.local` (gitignored via `.env*`); `.env.example` lists every key, no values.
- Schema changes: edit `prisma/schema.prisma`, then `npm run db:migrate` and commit the migration.
- Tests: `npm test` runs against `DATABASE_URL_TEST` only (it wipes that database).
- Filters live in URL search params so views are shareable and saveable
  (`course`, `cohort`, `region`, `range` | `from`/`to`; parse with `lib/filters.ts`).
- PM/Leadership mode: cookie `cc-mode` is the preference; `?mode=pm|leadership`
  overrides it for that page view only and never writes the cookie (`lib/mode.ts`).
- Run `npm run lint`, `npm test` and `npm run build` before declaring a phase done.

## Build phases (do one at a time, commit after each)
1. Foundation: schema, seed, app shell, theme, ⌘K, global filters, mode toggle, /data integrity page
1.5. Accounts, workspaces and your own data
   - Part A: PostgreSQL; Google sign-in (Auth.js), invite-only, every page requires login;
     User/Workspace/Membership/Invite with owner/editor/viewer roles; workspaceId on every
     entity and role checks in every lib/data function, with isolation tests; workspace
     switcher; onboarding (create workspace, demo data or empty); Settings (rename, members,
     invites, roles, remove, clear demo data); secrets in .env.local
   - Part B: create/edit forms (side sheet, zod validation, consistency rules) for Courses,
     Cohorts, Launches, Modules, Instructors, SMEs, Projects, Issues, Sessions (rating and
     attendance) and Learner feedback; Add on each section page, Edit in tables and from ⌘K;
     Quick add (C); ActivityEvent on every save; ⌘K reloads after saves; viewers get no
     Add/Edit and the server enforces the role
   - Part C: AI settings per workspace (owners edit): provider (OpenAI default, Gemini, Anthropic),
     API key encrypted with ENCRYPTION_KEY and shown masked, model, "Test key"; lib/ai/provider.ts
     uses the workspace key or the mock; per-workspace usage log (requests, tokens) in Settings;
     optional monthly request limit (AI off when reached); AI mode chip in the header
   - Part D: import for Courses, Cohorts, Instructors, SMEs, Modules from CSV or Google Sheets
     (read-only Sheets permission requested only when chosen); column mapping by hand, with
     AI suggestions via lib/ai/provider.ts; preview of new/updated/unchanged/invalid rows using
     the Add forms' validation; match by name (code/email guard); saved mappings; one-way
     "Sync now" for linked sheets; one ActivityEvent per import; editors and owners only
   - Part E: account menu (sidebar footer); soft delete to Trash for every record type with dependents
     preview, typed confirmation, bulk delete and Undo; owner-only Trash page (restore, delete forever,
     empty, 30-day expiry); synced sheets skip deleted records; delete workspace (owners) and delete
     your own account (deletes workspaces you alone own)
2. Command Center home: attention queue, what changed, risk radar, portfolio health, daily brief
3. Class Health + Learner Voice: low-rated detection, "Why?" drill-down, feedback clusters, sentiment
4. Cohorts, timeline (collision warnings), launches, launch checklists
5. Instructor/SME hub: hiring pipeline kanban, profiles, matching engine, performance cards
6. Curriculum: roadmap, kanban/timeline with bottleneck detection, version history
7. Projects & capstones, issue tracker, issue intelligence (pattern clustering)
8. AI layer: copilot with cited records, PM Memory, what-if simulator, weekly review export
9. Polish: notifications, saved views, responsive, run the 10 design-test workflows
