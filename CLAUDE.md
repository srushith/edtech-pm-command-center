# EdTech PM Command Center

A multi-user operating system for EdTech Product/Curriculum Managers running courses,
cohorts, instructors, SMEs and learner experiences. Each PM works in their own workspace
and can invite colleagues. Demo user: Srushith.
This is an operational PM tool, NOT a BI dashboard. Optimize for decision speed: a PM
should know what is healthy, broken, changed, at risk, and what to do next within 30 seconds.

## Core product principle
Every signal follows: Metric -> Signal -> Evidence -> Root Cause -> Action.
- Never show a bare number. Show change vs previous period, the cause, and a next action.
- Every important item has an action (Review recording, Contact instructor, Escalate to
  Ops, Assign owner, Mark resolved, etc.). Actions update the database and log an ActivityEvent.
- AI output is always labeled "AI Insight" (purple) with "View evidence" linking to the
  underlying records. Never present AI conclusions as fact.

## Stack (free / open source, except the AI provider)
- Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- Recharts for charts, lucide-react for icons, cmdk (shadcn Command) for the palette
- Prisma + PostgreSQL on Neon (main branch = app, test branch = tests)
- Auth.js (next-auth v5) with Google sign-in, JWT sessions, Prisma adapter
- AI through `lib/ai/provider.ts`: each workspace's own key (OpenAI default; Gemini and
  Anthropic supported), mock provider when no key is set
- No email sending: invites are pending records the invitee accepts by signing in.

## Sidebar (in this order)
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

Data Integrity (`/data`) lives in the sidebar footer and in ⌘K, not the main nav.
The account menu (Settings, Sign out) sits in the sidebar footer. It also shows the name, email,
current workspace and role, and Trash for owners. Settings (`/settings`, with `/settings/trash`)
is in ⌘K too. The sidebar header is the workspace switcher.
`lib/nav.ts` is the single source for these lists. Outside the dashboard: `/signin`, `/onboarding`.

## Modes
PM mode: full operational detail, owners, tasks, actions.
Leadership mode: health, satisfaction, launch status, major risks, trends, decisions needed;
no owners, tasks or action buttons. Stored in a cookie; `?mode=pm|leadership` in the URL
overrides it for that page view without changing the cookie.
(Cookie `cc-mode`; resolved in `lib/mode.ts`.)

## Design rules
- Dark-first, light mode optional. Thin borders, dense but readable, strong type.
- Color is for status only: green healthy, yellow attention, red critical,
  blue info/active, purple AI insight. No decorative gradients or colorful cards.
- Feel: Linear / Vercel / Bloomberg density. Keyboard-first (⌘K, C for quick add).
- Home hierarchy: attention -> what changed -> risk -> what's next -> portfolio -> analytics.

## Data
Core entities: Course, Cohort, Instructor, SME, Module, Session, LearnerFeedback, Issue,
Project, Launch, plus ModuleVersion, ChecklistItem, ActivityEvent, and account models
User, Workspace, Membership, Invite.
Added for the phases below: NpsSurvey (cohort, round NPS-1 or NPS-2, scheduled week,
release date, responses, promoters, passives, detractors, score, comments) and
ProjectSubmission (learner, project, cohort, submitted_at, grading status, grade, grader).
SME records track hiring stage, stage dates, hire date (for "hired this quarter") and
training status.

Google Sheets are the team's existing source for cohorts, instructors, courses, modules,
class ratings and upcoming cohorts. Data comes in through the importer (CSV or linked
sheet, one-way "Sync now"). Imports reuse the same validation as the Add forms, update
existing records instead of duplicating, and skip records the user has deleted.
Demo data is created per workspace from onboarding and must stay internally consistent
(attendance <= learners, feedback and NPS response counts plausible for cohort size,
ratings consistent with feedback sentiment).

Implementation (`prisma/schema.prisma`):
- Also in the schema: Account (Auth.js), ImportSource, ImportRun, ImportLink, TrashBatch,
  WorkspaceAISettings, AIUsageEvent.
- Every domain model has `workspaceId`, `isDemo`, and `deletedAt`/`trashBatchId` for Trash.
  Required parent links are composite foreign keys `[parentId, workspaceId]`, so the database
  rejects cross-workspace children. Optional links are checked in lib/data and by /data's
  "Links stay inside the workspace".
- Demo data ("Start with demo data", `lib/demo/seed.ts`) is deterministic: 10 cohorts across
  8 courses, 20+ instructors, 30+ SMEs, 50+ sessions, 100+ feedback records, 20+ issues,
  10+ modules, 5+ launches. Courses: Agentic AI (US), Transformative GenAI (India),
  AI Engineering, PM, TPM, EM, SWE, FDE.

## Security and access rules (non-negotiable)
- Every lib/data function filters by the current workspace. No query without workspaceId.
- Roles: owner (members, settings, AI key, permanent delete), editor (add, edit, import,
  move to Trash), viewer (read only). Enforce on the server, not only in the UI.
- Sign-in is invite-only: ALLOWED_EMAILS admins, or users with an invite or membership.
- Secrets live only in .env.local (gitignored); .env.example lists keys without values.
- AI keys are encrypted with ENCRYPTION_KEY and never sent to the browser.
- Deletes are soft (Trash, 30-day restore); deleted items vanish from pages, search,
  counts and AI features.

## Conventions
- Feature folders under `app/(dashboard)/<section>`; shared UI in `components/`.
- Data access only through `lib/data/*`, never directly in components.
- Filters live in URL search params so views are shareable and saveable
  (`course`, `cohort`, `region`, `range` | `from`/`to`; parse with `lib/filters.ts`).
- All numbers are computed from the database, never hard-coded.
- Schema changes go through Prisma migrations: edit `prisma/schema.prisma`, then
  `npm run db:migrate` and commit the migration.
- Run `npm run lint`, `npm test` and `npm run build` before declaring a phase done.
- Tests: `npm test` runs against `DATABASE_URL_TEST` only (it wipes that database).
- Workspaces and roles:
  - Every page and server action gets its context from `requireWorkspace()` (`lib/auth/session.ts`);
    `proxy.ts` is only an optimistic cookie check, never the security boundary.
  - Every `lib/data` function takes a `WorkspaceContext` and reads/writes domain models only
    through `scopedDb(ctx)` (`lib/data/scoped.ts`): it filters by workspace, stamps creates, and
    blocks writes for viewers. Use flat inputs (no nested writes); no raw SQL on domain data.
  - Workspace/member/invite functions live in `lib/data/workspaces.ts` and check roles explicitly
    (`requireRole`). Owners also clear demo data and delete the workspace. A workspace always
    keeps at least one owner. Deleting your own account deletes the workspaces you alone own.
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
  - Edit forms load fresh values on every open and save with the `rowVersion` they loaded; the update
    applies only at that version, else "This record was updated since you opened it" (Reload). Every other
    write of form-editable fields bumps `rowVersion` (persistRecord does; ad-hoc updateMany must too).
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
  clicking user's own Google grant; refresh tokens are encrypted at rest with `lib/crypto.ts`
  (see `lib/google/sheets.ts`).
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

## Build phases (one at a time, commit and push after each)
1. DONE. Foundation: schema, app shell, theme, ⌘K search, global filters, mode toggle, /data
1.5 Accounts, workspaces and your own data
   A. DONE. Postgres, Google sign-in, workspaces, roles, invites, onboarding, isolation tests
   B. DONE. Add and edit forms for every entity, quick add
   C. DONE. AI settings per workspace (encrypted key, test key, usage log, monthly limit)
   D. DONE. Import from CSV or Google Sheet link, column mapping, preview, saved mappings, Sync now
   E. DONE. Account menu and sign out, soft delete with Trash, bulk delete, delete workspace/account
2. Command Center home: attention queue, what changed, risk radar, portfolio health,
   daily brief
3. Class Health + Learner Voice: low-rated class detection from the synced Google Sheet
   ratings (configurable threshold), "Why?" drill-down, learner feedback, feedback themes,
   sentiment by course, cohort, module, instructor and week
4. Cohorts: cohort health and progress, new launches driven by the upcoming cohorts sheet,
   NPS-1 and NPS-2 schedule per cohort (which week each is released, whether it is live,
   response rate, score and trend between rounds)
5. Instructor / SME Hub: SMEs hired this quarter, SMEs in the hiring pipeline by stage,
   SMEs in the training phase, with owners and next actions
6. Curriculum: detailed module view (objectives, sessions, owner, SME, status, version,
   resources, linked projects, feedback and ratings for the module)
7. Projects: cohort-wise submissions from learners, projects pending grading (with age),
   and graded projects, with completion rate per cohort and project
8. AI layer: copilot with cited records, PM Memory, what-if simulator, weekly review export
9. Polish: notifications, saved views, responsive layouts, run the 10 design-test workflows
