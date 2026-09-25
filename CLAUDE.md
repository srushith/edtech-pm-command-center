# EdTech PM Command Center

An internal operating system for an EdTech Product/Curriculum Manager running many
courses, cohorts, instructors, SMEs and learner experiences. Demo user: Srushith.
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
- Prisma ORM with SQLite locally (switch to Postgres on deploy)
- No paid services. AI is mocked behind `lib/ai/provider.ts` with a single
  interface so a real provider can be plugged in later.

## Design rules
- Dark-first, light mode optional. Thin borders, dense but readable, strong type.
- Color is for status only: green healthy, yellow attention, red critical,
  blue info/active, purple AI insight. No decorative gradients or colorful cards.
- Feel: Linear / Vercel / Bloomberg density. Keyboard-first (⌘K, shortcuts).
- Home hierarchy: attention -> what changed -> risk -> what's next -> portfolio -> analytics.

## Data model (see prisma/schema.prisma)
Course, Cohort, Instructor, SME, Module, Session, LearnerFeedback, Issue, Project,
Launch, plus ModuleVersion, ChecklistItem, ActivityEvent (for "What changed").
Mock data volumes: 10 cohorts across 8 courses, 20+ instructors, 30+ SMEs,
50+ sessions, 100+ feedback records, 20+ issues, 10+ modules, 5+ launches.
Seed must be deterministic and internally consistent (attendance <= learners,
feedback counts plausible for cohort size, ratings match feedback sentiment).
Courses: Agentic AI (US), Transformative GenAI (India), AI Engineering, PM, TPM, EM, SWE, FDE.

## Conventions
- Feature folders under `app/(dashboard)/<section>`; shared UI in `components/`.
- Data access only through `lib/data/*` functions, never directly in components.
- Filters live in URL search params so views are shareable and saveable.
- Run `npm run lint` and `npm run build` before declaring a phase done.

## Build phases (do one at a time, commit after each)
1. Foundation: schema, seed, app shell, theme, ⌘K, global filters, mode toggle, /data integrity page
2. Command Center home: attention queue, what changed, risk radar, portfolio health, daily brief
3. Class Health + Learner Voice: low-rated detection, "Why?" drill-down, feedback clusters, sentiment
4. Cohorts, timeline (collision warnings), launches, launch checklists
5. Instructor/SME hub: hiring pipeline kanban, profiles, matching engine, performance cards
6. Curriculum: roadmap, kanban/timeline with bottleneck detection, version history
7. Projects & capstones, issue tracker, issue intelligence (pattern clustering)
8. AI layer: copilot with cited records, PM Memory, what-if simulator, weekly review export
9. Polish: notifications, saved views, responsive, run the 10 design-test workflows
