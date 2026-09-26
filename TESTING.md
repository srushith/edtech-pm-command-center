# Testing: Phase 1 and 1.5 (A–E)

Inventory of every feature and user action built so far, and how each one is tested.
Tests run with `npm test` against `DATABASE_URL_TEST` only (`scripts/test.mjs` refuses to start
if it is unset or equal to `DATABASE_URL`). Browser tests run with `npm run test:e2e` against the same
database (section 11). Both wipe it, so don't run them at the same time.

**Roles:** O = owner, E = editor, V = viewer, Any = any member of the workspace, Out = signed out.

**Automated test:** `yes` = an existing test covers it (file named), `partial` = covered only in part
(the gap is named), `no` = no test yet. The `npm test` suites call `lib/data` functions directly; none call the
server actions in `app/**/actions.ts`, which is where Step 2 adds coverage. `e2e` = the Playwright
end-to-end suite (`npm run test:e2e`, section 11) drives it in a real browser, through the server actions.

**Status:** `Not run` = not yet run for this pass. Step 3 fills in Pass / Fail (bug #) / Manual.

## 1. Access and sign-in

| # | Feature | Where | Roles allowed | Automated test | Status |
|---|---|---|---|---|---|
| 1.1 | Signed-out request redirects to `/signin?from=…` | `proxy.ts` | Out | yes (e2e journeys) | Not run |
| 1.2 | Server-side guard: no session → `/signin`, no workspace → `/onboarding` | `requireUser` / `requireWorkspace` in `lib/auth/session.ts` | Any | partial (e2e: no session → `/signin`; owner with no workspace → `/onboarding`) | Not run |
| 1.3 | "Continue with Google" sign-in | `/signin` | Out | no (Google OAuth; manual). e2e signs in with the test-only provider instead | Not run |
| 1.4 | Signed-in user visiting `/signin` goes to `from` (open-redirect safe) | `/signin`, `lib/safe-redirect.ts` | Any | no | Not run |
| 1.5 | Invite-only: ALLOWED_EMAILS admins, members and invitees allowed; strangers rejected | `isSignInAllowed`, Auth.js `signIn` callback | Out | yes (tenancy; e2e: uninvited email refused) | Not run |
| 1.6 | Unverified Google email rejected | Auth.js `signIn` callback | Out | no | Not run |
| 1.7 | Expired invites don't allow sign-in | `isSignInAllowed` | Out | yes (tenancy) | Not run |
| 1.8 | Signing in turns pending invites into memberships with the invited role | `acceptPendingInvites` | Any | yes (tenancy) | Not run |
| 1.9 | Existing member signs in again (no duplicate membership, role kept) | `acceptPendingInvites` | Any | partial (role kept on upsert not asserted) | Not run |
| 1.10 | AccessDenied error message shown on `/signin` | `/signin?error=AccessDenied` | Out | no (UI; manual) | Not run |
| 1.11 | Sign out (clears `cc-workspace` cookie) | Account menu → Sign out, `signOutAction` | Any | yes (e2e, each role) | Not run |

## 2. Onboarding and workspaces

| # | Feature | Where | Roles allowed | Automated test | Status |
|---|---|---|---|---|---|
| 2.1 | Create first workspace (blank) | `/onboarding`, `createWorkspaceAction` | Any signed-in user | partial (via helpers, not the action) | Not run |
| 2.2 | Create workspace with "Start with demo data" | `/onboarding` | Any signed-in user | yes (e2e owner journey, through the UI) | Not run |
| 2.3 | New workspace from the switcher (`/onboarding?new=1`) | Workspace switcher | Any | no | Not run |
| 2.4 | Onboarding redirects to `/` when user already has a workspace | `/onboarding` | Any | no | Not run |
| 2.5 | Switch workspace (membership checked, filters dropped) | Sidebar header, `switchWorkspace` | Member of target | no | Not run |
| 2.6 | `cc-workspace` cookie naming a non-member workspace falls back to user's first | `requireWorkspace` | Any | no | Not run |
| 2.7 | Rename workspace | `/settings`, `renameAction` | O | yes (tenancy, lib level) | Not run |
| 2.8 | Invite member by email + role (pending, 14-day expiry, no email sent) | `/settings`, `inviteAction` | O | yes (tenancy, accounts; lib level; e2e owner journey through the UI) | Not run |
| 2.9 | Revoke invite | `/settings`, `revokeInviteAction` | O | yes (tenancy, lib level) | Not run |
| 2.10 | Change member role | `/settings`, `changeRoleAction` | O | yes (tenancy, lib level) | Not run |
| 2.11 | Remove member / leave workspace (redirect when removing yourself) | `/settings`, `removeMemberAction` | O (others), Any (self) | partial (self-leave not tested) | Not run |
| 2.12 | Last owner can't be removed or demoted | `lib/data/workspaces.ts` | O | yes (tenancy) | Not run |
| 2.13 | Removed member loses access immediately | `contextFor` | — | yes (tenancy) | Not run |
| 2.14 | Clear demo data (removes only `isDemo` rows) | `/settings`, `clearDemoDataAction` | O | partial (isolation tested; user rows kept not asserted) | Not run |
| 2.15 | Delete workspace (type name) | `/settings`, `deleteWorkspaceAction` | O | yes (tenancy, lib level) | Not run |
| 2.16 | Delete account (type email; deletes solo-owned workspaces, leaves shared; revokes Google) | `/settings`, `deleteAccountAction` | Any (own account) | yes (accounts) | Not run |

## 3. App shell, navigation and modes

| # | Feature | Where | Roles allowed | Automated test | Status |
|---|---|---|---|---|---|
| 3.1 | Sidebar: 11 sections in CLAUDE.md order; Data + Settings in footer | `components/shell/app-sidebar.tsx`, `lib/nav.ts` | Any | yes (e2e: order and every link, each role) | Not run |
| 3.2 | Account menu: name, email, workspace, role, Settings, Trash (owners), Sign out | Sidebar footer | Any (Trash: O) | yes (e2e: email, workspace, role; Trash for owners only) | Not run |
| 3.3 | Section pages render (placeholder + records panels) | `/`, `/cohorts`, `/courses`, `/curriculum`, `/talent`, `/class-health`, `/learner-voice`, `/launches`, `/projects`, `/operations`, `/ai-insights` | Any | yes (e2e: every section renders, each role) | Not run |
| 3.4 | "g" + letter keyboard navigation | Command palette listener | Any | no (UI; manual) | Not run |
| 3.5 | Theme toggle (dark/light) | Top bar, ⌘K action | Any | no (UI; manual) | Not run |
| 3.6 | Mode toggle PM / Leadership writes `cc-mode` cookie | Top bar, ⌘K action | Any | no | Not run |
| 3.7 | `?mode=` overrides for that view, doesn't write the cookie, shows "Shared view" | `lib/mode.ts`, `getMode`, `useMode` | Any | no | Not run |
| 3.8 | Leadership mode hides owners, tasks and action buttons | All section pages | Any | no | Not run |
| 3.9 | AI mode chip (links to `/settings#ai` for owners only) | Top bar | Any (link: O) | no | Not run |

## 4. Search (⌘K) and filters

| # | Feature | Where | Roles allowed | Automated test | Status |
|---|---|---|---|---|---|
| 4.1 | ⌘K / Ctrl+K opens palette; index loaded via `searchIndex` action | `command-palette.tsx`, `app/(dashboard)/actions.ts` | Any | yes (lib level; e2e: Ctrl+K opens and finds records) | Not run |
| 4.2 | Finds every entity type (course, cohort, launch, module, instructor, SME, project, issue, session, feedback) | `getSearchIndex`, `searchRecords` | Any | partial (not every type asserted) | Not run |
| 4.3 | Case-insensitive, word-start matching, highlight | `lib/search.ts` | Any | yes (search) | Not run |
| 4.4 | "rag" returns ≥ 5 groups | `lib/search.ts` | Any | yes (search) | Not run |
| 4.5 | Trashed records excluded | `getSearchIndex` | Any | yes (trash) | Not run |
| 4.6 | Only current workspace's records | `getSearchIndex` | Any | yes (tenancy) | Not run |
| 4.7 | No-results suggestions | `suggestQueries` | Any | yes (search) | Not run |
| 4.8 | Open record from ⌘K (`?focus=type:id`), "not found" for other workspace / trashed | `getFocusedEntity` | Any | yes (tenancy; e2e opens a result) | Not run |
| 4.9 | Palette actions: theme, mode, clear filters, Quick add / New X…, Import X… (editors only) | `command-palette.tsx` | Any (create/import: O, E) | partial (e2e: "New cohort…" for editors/owners only) | Not run |
| 4.10 | Filter bar: course, cohort, region, date range presets, custom from/to, Clear | `filter-bar.tsx` | Any | no | Not run |
| 4.11 | Filter URL parsing validates and drops malformed values; from>to swapped | `lib/filters.ts` `parseFilters` | Any | no | Not run |
| 4.12 | Filters narrow section tables (course/cohort/region) | `listRecords` | Any | no | Not run |
| 4.13 | Date range filter narrows results | `listRecords` | Any | no | Not run |
| 4.14 | Filter options come from this workspace only | `getFilterOptions` | Any | yes (tenancy) | Not run |
| 4.15 | Navigation keeps filters (not mode) | `useHrefWithFilters` | Any | no | Not run |

## 5. Add and edit records (10 types)

Types: course, cohort, launch, module, instructor, SME, project, issue, session, feedback.
Entry points: section "Add" button, row Edit, ⌘K "New X…", Quick add (C), record sheet.

| # | Feature | Where | Roles allowed | Automated test | Status |
|---|---|---|---|---|---|
| 5.1 | Load form (options, existing values; other workspace's id → error) | `loadRecordForm` | O, E | no (action) | Not run |
| 5.2 | Save valid record, each type | `saveRecordAction` → `saveRecord` | O, E | yes (records, lib level; e2e adds and edits a cohort through the sheet) | Not run |
| 5.3 | Viewer can't create/edit (server) | `saveRecordAction`, `loadRecordForm` | — | partial (lib level; e2e: viewer gets no Add/Edit/Delete/Quick add) | Not run |
| 5.4 | Cohort needs a course from this workspace | `lib/records/cohort.ts` | O, E | yes (records) | Not run |
| 5.5 | Invalid / out-of-order dates rejected | record schemas | O, E | yes (records) | Not run |
| 5.6 | Enrolled ≤ capacity < 100 | cohort | O, E | yes (records) | Not run |
| 5.7 | Attendance ≤ cohort learners | session | O, E | yes (records) | Not run |
| 5.8 | Session inside cohort window; status agrees with date; module in cohort's course | session | O, E | yes (records) | Not run |
| 5.9 | Feedback needs a completed session with room | feedback | O, E | yes (records) | Not run |
| 5.10 | Issue links chain; resolution after opening | issue | O, E | yes (records) | Not run |
| 5.11 | Project cohort of course, due in cohort, submissions ≤ learners | project | O, E | yes (records) | Not run |
| 5.12 | Duplicate course/cohort codes and instructor/SME emails rejected | `lib/data/records.ts` | O, E | partial (course code + email; cohort code and SME email not asserted) | Not run |
| 5.13 | Editing a cohort can't strand its sessions/feedback | cohort handler | O, E | yes (records) | Not run |
| 5.14 | Derived values: sentiment, learnerId, ratings, cohort status, issue code, module order, launch checklist | `lib/data/records.ts` | O, E | yes (records) | Not run |
| 5.15 | Every save logs an ActivityEvent (created/updated/status_changed) | `saveRecord` | O, E | yes (records) | Not run |
| 5.16 | Mark instructors inactive | `markInstructorsInactiveAction` | O, E | yes (trash, lib level) | Not run |
| 5.17 | Quick add (C) picks a type then opens the form | `quick-add.tsx` | O, E | partial (e2e: C opens Quick add for editors/owners, not viewers) | Not run |
| 5.18 | Section records panel: counts, "showing 50", Add/Import hidden for viewers | `records-panel.tsx` | Any | partial (e2e: Add/Import hidden for viewers) | Not run |

## 6. Import (CSV and Google Sheets)

Importable types: course, cohort, instructor, SME, module. Page `/import` (editors and owners).

| # | Feature | Where | Roles allowed | Automated test | Status |
|---|---|---|---|---|---|
| 6.1 | Viewer sees "Importing is for editors" page | `/import` | V | yes (e2e viewer journey) | Not run |
| 6.2 | CSV parsing: BOM, quoted commas/newlines, blank lines, repeated headers | `lib/import/parse.ts` | O, E | yes (import) | Not run |
| 6.3 | Messy headers (case, spaces, punctuation), "TBD" cells, blank rows | parse/normalize | O, E | partial (no "TBD" or fixture files) | Not run |
| 6.4 | Dates: ISO, sheet serials, month names; ambiguous d/m refused | `normalizeDate` | O, E | yes (import) | Not run |
| 6.5 | Column mapping: exact header matches; AI suggestions (mock) with evidence; accept | `prepareMappingAction`, `lib/ai/column-mapping.ts` | O, E | yes (import, ai) | Not run |
| 6.6 | Mapping problems block preview (required fields unmapped) | `mappingProblems` | O, E | no | Not run |
| 6.7 | Preview: new / updated / unchanged / invalid rows, writes nothing | `previewImportAction` | O, E | partial (new only asserted; updated/invalid mix untested; e2e previews in the UI) | Not run |
| 6.8 | Import: creates, updates by name, blank cells keep values, one ActivityEvent, ImportRun recorded | `runImportAction` | O, E | yes (import; e2e CSV import through the wizard, owner and editor) | Not run |
| 6.9 | Re-import is idempotent (no duplicates) | `runImport` | O, E | yes (import) | Not run |
| 6.10 | Saved mappings remembered by header signature, even reordered | ImportSource | O, E | yes (import) | Not run |
| 6.11 | Code/email pointing at a different record → invalid; ambiguous names → invalid | `planRows` | O, E | yes (import) | Not run |
| 6.12 | Cohort import uses Add-form rules (course by code or name) | `validateRecord` | O, E | yes (import) | Not run |
| 6.13 | Google Sheets: grant access, open link, list tabs | `openSheetAction`, `grantSheetsAccessAction` | O, E | yes (import, fake Google API) | Not run |
| 6.14 | Sync now (linked sheet) with clicking user's own grant | `syncSourceAction` | O, E | yes (import) | Not run |
| 6.15 | Rows whose record was deleted in app are skipped on sync, even after purge | ImportLink | O, E | yes (import) | Not run |
| 6.16 | Changed sheet columns stop the sync | `syncImportSource` | O, E | yes (import) | Not run |
| 6.17 | Sources list, "Import again" (`?source=`) | `/import` | O, E | partial | Not run |
| 6.18 | Viewer blocked from prepare/preview/import/sync (server) | import actions | — | yes (import, lib level) | Not run |
| 6.19 | Another workspace's sources invisible and unsyncable | `getImportSource`, `syncImportSource` | — | yes (import) | Not run |
| 6.20 | Import skips records in Trash (doesn't recreate them as duplicates) | `runImport` | O, E | no | Not run |

## 7. Delete, Trash and Undo

| # | Feature | Where | Roles allowed | Automated test | Status |
|---|---|---|---|---|---|
| 7.1 | Delete preview lists dependents; typed name (count for bulk) required when anything else goes | `previewDeleteAction`, `delete-dialog.tsx` | O, E | yes (trash; e2e: preview for a cohort with nothing under it) | Not run |
| 7.2 | Soft delete moves subtree to Trash as one batch, logs `deleted` | `deleteRecordsAction` | O, E | yes (trash; e2e deletes a cohort) | Not run |
| 7.3 | Trashed rows gone from tables, search, pickers, filters, counts and edits | `scopedDb` | Any | yes (trash) | Not run |
| 7.4 | Undo within 2 minutes, by the deleter only | `undoDeleteAction` | Deleter | yes (trash; e2e Undo from the toast) | Not run |
| 7.5 | Restore from Trash (in order; child can't return before parent) | `/settings/trash`, `restoreFromTrashAction` | O | yes (trash) | Not run |
| 7.6 | Delete forever (children first) | `/settings/trash`, `deleteForeverAction` | O | yes (trash) | Not run |
| 7.7 | Empty Trash (type phrase) | `/settings/trash`, `emptyTrashAction` | O | yes (trash) | Not run |
| 7.8 | 30-day lazy purge (on delete, save, import, Trash view) | `purgeExpiredTrash` | — | yes (trash) | Not run |
| 7.9 | Codes and emails stay reserved while in Trash | `saveRecord` | O, E | partial (course code only) | Not run |
| 7.10 | Instructors with sessions blocked; Mark inactive offered | `previewDelete`, dialog | O, E | yes (trash) | Not run |
| 7.11 | "Reassign work" for blocked instructors | delete dialog | O, E | no (not implemented) | Not run |
| 7.12 | Bulk delete (row checkboxes) | `records-table.tsx` | O, E | yes (trash, lib level) | Not run |
| 7.13 | Deleting feedback recomputes ratings; restore puts them back | `deleteRecords` | O, E | yes (trash) | Not run |
| 7.14 | Viewers can't delete; editors can't see/restore/purge/empty Trash | trash actions | — | yes (trash, lib level; e2e: viewer has no delete buttons) | Not run |
| 7.15 | `/settings/trash` page for non-owners | `/settings/trash` | O | no | Not run |

## 8. AI settings

| # | Feature | Where | Roles allowed | Automated test | Status |
|---|---|---|---|---|---|
| 8.1 | Save provider, model, key, monthly limit | `/settings#ai`, `saveAISettingsAction` | O | yes (ai, lib level) | Not run |
| 8.2 | Key encrypted at rest (AES-256-GCM, purpose-bound) | `lib/crypto.ts` | — | yes (ai) | Not run |
| 8.3 | Key never in any response to the browser; only masked last-4 | `getAISettingsView`, settings page, layout | Any | partial (view object only; not the server actions' return values) | Not run |
| 8.4 | Test key (typed or saved), readable errors, never returns key | `testAIKeyAction` | O | yes (ai, lib level; providers stubbed) | Not run |
| 8.5 | Remove key → mock | `removeAIKeyAction` | O | yes (ai) | Not run |
| 8.6 | No key → mock provider | `getAIProvider` | — | yes (ai) | Not run |
| 8.7 | Monthly limit turns AI off; CC_AI=off | `getAIProvider` | — | yes (ai) | Not run |
| 8.8 | Usage log per workspace | `/settings`, AIUsageEvent | O | yes (ai) | Not run |
| 8.9 | Editors/viewers can't change, test or remove | ai-settings | — | yes (ai, lib level) | Not run |
| 8.10 | Only lib/ai reaches providers; client components don't import secrets | static check | — | yes (ai) | Not run |

## 9. Demo data and Data Integrity

| # | Feature | Where | Roles allowed | Automated test | Status |
|---|---|---|---|---|---|
| 9.1 | Demo seed counts (10 cohorts / 8 courses, 20+ instructors, 30+ SMEs, 50+ sessions, 100+ feedback, 20+ issues, 10+ modules, 5+ launches) | `lib/demo/seed.ts` | — | no (counts not asserted) | Not run |
| 9.2 | All 10 integrity checks pass on fresh demo data | `/data`, `runIntegrityChecks` | Any | partial (after edits/imports only) | Not run |
| 9.3 | `/data` record counts and targets | `/data`, `getRecordCounts` | Any | yes (tenancy, isolation) | Not run |
| 9.4 | Demo seed deterministic (same output twice) | `seedDemoData` | — | no | Not run |
| 9.5 | Clear demo data leaves the user's own records and their links | `clearDemoData` | O | no | Not run |

## 10. Workspace isolation (cross-cutting)

| # | Feature | Where | Roles allowed | Automated test | Status |
|---|---|---|---|---|---|
| 10.1 | A can't list/read B's records, every entity type | `scopedDb`, `listRecords` | — | partial (not every type through `listRecords`) | Not run |
| 10.2 | A can't edit B's records by id, every entity type | `saveRecord` | — | partial (some types) | Not run |
| 10.3 | A can't delete/preview/undo/restore/purge B's records | trash | — | yes (tenancy) | Not run |
| 10.4 | A can't import into B / sync B's sources | imports | — | yes (import) | Not run |
| 10.5 | A's ⌘K / focus can't find B | search | — | yes (tenancy) | Not run |
| 10.6 | A's `/data` counts and checks cover A only | integrity | — | yes (tenancy) | Not run |
| 10.7 | A's AI settings, usage and provider are A's only | ai-settings | — | yes (ai) | Not run |
| 10.8 | DB rejects a child in A pointing at B's parent | composite FKs | — | yes (tenancy) | Not run |
| 10.9 | Server actions resolve workspace from session + cookie, never from client input | `app/**/actions.ts` | — | no | Not run |

## 11. End-to-end tests (Playwright)

`npm run test:e2e` (= `playwright test`, config in `playwright.config.ts`, specs in `e2e/`). About 6–7 minutes.
First time on a machine: `npx playwright install chromium`. Extra arguments go to Playwright, e.g.
`npm run test:e2e -- e2e/journeys.spec.ts -g viewer` or `npm run test:e2e -- --headed`. Report: `npx playwright show-report`
(traces and screenshots of failures are in `test-results/`).

**How it runs.** Global setup (`e2e/global-setup.ts`) migrates `DATABASE_URL_TEST`, wipes it and seeds
"Shared programs" (demo data, owned by lead@e2e.test, pending invites for editor@e2e.test and viewer@e2e.test).
Playwright then starts `next dev --port 3100` with `NODE_ENV=test`, `DATABASE_URL=$DATABASE_URL_TEST`,
`NEXT_DIST_DIR=.next-e2e` and `ALLOWED_EMAILS=owner@e2e.test`, so it runs alongside `npm run dev`
(port 3000, `.next`). The config refuses to start if `DATABASE_URL_TEST` is unset or equals `DATABASE_URL`.
Migrations run without Prisma's advisory lock (`PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`); see bug E2E-8.
The specs hide the Next.js dev overlay (its badge covers the account menu) and collect browser console
errors and uncaught page errors instead. A spec fails if there are any.

**Signing in.** Google OAuth can't be automated, so `lib/auth/test-sign-in.ts` adds an Auth.js credentials
provider, `test-login` (email only, no password). It is registered only when all three hold: the code wasn't built for
production (`process.env.NODE_ENV`, which Next inlines at build time), the server's runtime `NODE_ENV` is `test`,
and `DATABASE_URL` equals `DATABASE_URL_TEST`. Invite-only still applies: the provider only says who you are,
and the `signIn` callback turns away anyone who isn't an admin, member or invitee. `signIn()` in `e2e/support/app.ts`
posts to it the way a form would (CSRF token, then `/api/auth/callback/test-login`).

| Check | Where | Result |
|---|---|---|
| Enabled only when build ≠ production, runtime NODE_ENV = test and DATABASE_URL = DATABASE_URL_TEST; Auth.js registers it in one place, behind the inlined `process.env.NODE_ENV` | `tests/test-sign-in.test.ts` (`npm test`) | Pass |
| The e2e server offers `google` and `test-login` (control) | `e2e/sign-in-guard.spec.ts` | Pass |
| `next dev` (NODE_ENV=development) on the test database: no `test-login`; posting to it sets no session | `e2e/sign-in-guard.spec.ts` | Pass |
| `next build` + `next start` with NODE_ENV=test on the test database: no `test-login`; posting to it sets no session | `e2e/sign-in-guard.spec.ts` (builds into `.next-e2e-prod`) | Pass |
| An uninvited email is refused (`/signin?error=AccessDenied`, message shown) | `e2e/journeys.spec.ts` | Pass |

**Journeys** (`e2e/journeys.spec.ts`), one test per role:

| Step | Owner (owner@e2e.test) | Editor (editor@e2e.test) | Viewer (viewer@e2e.test) |
|---|---|---|---|
| Signed out: `/cohorts` → `/signin?from=%2Fcohorts` | Pass | Pass | Pass |
| Sign in | Pass | Pass (invite accepted) | Pass (invite accepted) |
| Onboarding with demo data → Command Center | Pass | n/a: lands in Shared programs | n/a: lands in Shared programs |
| Account menu: email, workspace, role; Trash for owners only | Pass | Pass | Pass |
| Every sidebar section in CLAUDE.md order, plus Data Integrity and Settings | Pass | Pass | Pass |
| ⌘K: "New cohort…" only for editors/owners; search "agentic", open a result (`?focus=`) | Pass | Pass | Pass |
| C opens Quick add | Pass | Pass | Pass (nothing opens) |
| Add a cohort | Pass | Pass | Pass (no Add button) |
| Edit it (name, learners); table updates | Pass | Pass | Pass (no Edit buttons) |
| Reopening Edit shows the saved values | **Fail: E2E-1** | **Fail: E2E-1** | n/a |
| Delete it → Trash toast; Undo restores it | Pass | Pass | Pass (no Delete buttons or checkboxes) |
| Import a CSV of courses: map, preview, import, see the row in Courses | Pass | Pass | Pass ("Importing is for editors and owners") |
| Invite a colleague from Settings | Pass | n/a | n/a |
| Sign out → `/signin`; `/` stays signed out | Pass | Pass | Pass |
| No console errors | **Fail: E2E-2** | **Fail: E2E-2** | Pass |
| No uncaught page errors | **Intermittent: E2E-3** | **Intermittent: E2E-3** | Pass |

**Responsive smoke** (`e2e/responsive.spec.ts`), as layout@e2e.test (owner of Shared programs), at 1440, 1024, 768 and 390px:
no main section, `/data`, `/settings` or `/import` may scroll sideways; the sidebar must show every link
in view and navigate (below 768px it's a sheet behind "Toggle Sidebar"); ⌘K must fit on screen.

| Check | 1440 | 1024 | 768 | 390 |
|---|---|---|---|---|
| No horizontal scroll | Pass | **Fail: E2E-4** (7 pages) | **Fail: E2E-4** (all 14 pages) | Pass |
| Sidebar: all links in view, navigates | Pass | Pass | Pass | Pass |
| Mobile sidebar closes after picking a section | n/a | n/a | n/a | **Fail: E2E-5** |
| ⌘K palette fully on screen | **Fail: E2E-6** | **Fail: E2E-6** | **Fail: E2E-6** | **Fail: E2E-6** |
| No hydration errors | Pass | Pass | Pass | **Fail: E2E-7** |

Checks marked Fail are soft assertions: the run keeps going and lists all of them, and the test still fails.

### Bugs found by the end-to-end run (not fixed)

| # | Bug | Seen | Where to look |
|---|---|---|---|
| E2E-1 | After saving an edit, reopening Edit on the same record shows the **old** values (the form isn't reloaded). Saving again from that form would silently undo the first edit. | Every run, owner and editor | `components/records/record-sheet.tsx`: the loaded form is kept per `type:id`, so reopening renders the stale copy, and `RecordForm` (same `key`) keeps its initial state when fresh data arrives |
| E2E-2 | Console error on `/cohorts`, `/courses`, `/curriculum`, `/talent`, `/import` for editors and owners: "Base UI: A component that acts as a button expected a native `<button>` because the `nativeButton` prop is true". Links rendered through `<Button render={<Link/>}>` lose native link semantics (accessibility). | Every run | `components/records/records-panel.tsx` (Import link), `app/(dashboard)/import/import-wizard.tsx` ("View …" link) |
| E2E-3 | "Hydration failed" on `/import` during the CSV import step: the server rendered the top-bar title "Courses", the client "Import". | At least 3 of 7 owner/editor runs that reached the import step; not reproduced in isolation | `components/shell/top-bar.tsx` (title from `usePathname`), the Import link from `/courses` |
| E2E-4 | Pages scroll sideways at 1024px (`/cohorts`, `/talent`, `/class-health`, `/learner-voice`, `/launches`, `/projects`, `/operations`, up to 1152px wide) and on every page at 768px (up to 1024px wide). The main area (`main[data-slot=sidebar-inset]`) grows to fit its widest child instead of shrinking beside the sidebar, so the tables' own horizontal scroll never kicks in. | Every run | `components/ui/sidebar.tsx` `SidebarInset` (a flex item without `min-w-0`) |
| E2E-5 | Phone width: after you pick a section in the sidebar sheet, the sheet stays open over the new page. | Every run | `components/shell/app-sidebar.tsx` (nav links don't close the mobile sheet) |
| E2E-6 | The ⌘K palette runs off the bottom of the screen with its default list (bottom edge at 912px in a 900px-high window at 1440; 860px in 844px at 390), so the footer hints are cut off. | Every run | `components/shell/command-palette.tsx`, `components/ui/command.tsx` (dialog placed from the top, with a 60vh list) |
| E2E-7 | Phone width: every page load logs "Hydration failed". The server renders the desktop sidebar, the client the mobile sheet, and React rebuilds the shell (briefly two sidebar toggles in the DOM). | Every run at 390px | `hooks/use-mobile.ts`, `components/ui/sidebar.tsx` |
| E2E-8 | Setup: `DATABASE_URL_TEST` in `.env.local` is Neon's **pooled** URL (`-pooler` host), though `.env.example` asks for direct ones. Through the pooler, Prisma migrate's session advisory lock stuck to a pooled connection, and every later `prisma migrate deploy` (so `npm test` too) timed out with P1002 until those sessions were ended. | Once, after several runs | `.env.local`: use the direct (non-pooler) URL. `scripts/test.mjs` still migrates with the lock |
