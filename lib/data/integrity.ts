import type { WorkspaceContext } from "@/lib/auth/access";
import { scopedDb } from "@/lib/data/scoped";
import { mean, RESPONSE_RATE_BAND, round2, sentimentForRating } from "@/lib/domain/feedback";
import { DEMO_TODAY } from "@/lib/domain/time";

// ---------- Record counts ----------

export type RecordCount = {
  entity: string;
  count: number;
  target: number | null; // demo-data minimum from CLAUDE.md; null when none applies
};

/** Counts for the current workspace. Targets apply only while it holds demo data. */
export async function getRecordCounts(ctx: WorkspaceContext): Promise<RecordCount[]> {
  const db = scopedDb(ctx);
  const [
    courses, cohorts, instructors, smes, modules, moduleVersions, sessions,
    feedback, issues, projects, launches, checklistItems, activityEvents,
  ] = await Promise.all([
    db.course.count(), db.cohort.count(), db.instructor.count(), db.sME.count(),
    db.module.count(), db.moduleVersion.count(), db.session.count(),
    db.learnerFeedback.count(), db.issue.count(), db.project.count(),
    db.launch.count(), db.checklistItem.count(), db.activityEvent.count(),
  ]);
  const hasDemo = (await db.course.count({ where: { isDemo: true } })) > 0;
  const rows: RecordCount[] = [
    { entity: "Course", count: courses, target: 8 },
    { entity: "Cohort", count: cohorts, target: 10 },
    { entity: "Instructor", count: instructors, target: 20 },
    { entity: "SME", count: smes, target: 30 },
    { entity: "Module", count: modules, target: 10 },
    { entity: "ModuleVersion", count: moduleVersions, target: null },
    { entity: "Session", count: sessions, target: 50 },
    { entity: "LearnerFeedback", count: feedback, target: 100 },
    { entity: "Issue", count: issues, target: 20 },
    { entity: "Project", count: projects, target: null },
    { entity: "Launch", count: launches, target: 5 },
    { entity: "ChecklistItem", count: checklistItems, target: null },
    { entity: "ActivityEvent", count: activityEvents, target: null },
  ];
  return hasDemo ? rows : rows.map((r) => ({ ...r, target: null }));
}

// ---------- Integrity checks ----------

export type Violation = { recordId: string; detail: string };

export type IntegrityCheck = {
  id: string;
  name: string;
  rule: string;
  checked: number; // records examined
  checkedLabel: string;
  violations: Violation[];
  passed: boolean;
};

const MAX_LEARNERS = 100; // program constraint: every cohort is under 100 learners
const RATING_TOLERANCE = 0.005; // stored averages are rounded to 2dp

function check(
  id: string,
  name: string,
  rule: string,
  checked: number,
  checkedLabel: string,
  violations: Violation[],
): IntegrityCheck {
  return { id, name, rule, checked, checkedLabel, violations, passed: violations.length === 0 };
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

export async function runIntegrityChecks(ctx: WorkspaceContext): Promise<IntegrityCheck[]> {
  const db = scopedDb(ctx);
  // The dataset is small; load once and check in memory so every rule is explicit.
  const [cohorts, sessions, feedback, instructors, projects, links] = await Promise.all([
    db.cohort.findMany({
      select: { id: true, code: true, capacity: true, enrolledLearners: true, startDate: true, endDate: true },
    }),
    db.session.findMany({
      select: {
        id: true, cohortId: true, instructorId: true, status: true,
        scheduledAt: true, attendance: true, avgRating: true, moduleId: true, smeId: true,
      },
    }),
    db.learnerFeedback.findMany({
      select: {
        id: true, sessionId: true, cohortId: true, learnerId: true,
        rating: true, sentiment: true, createdAt: true,
      },
    }),
    db.instructor.findMany({ select: { id: true, name: true, rating: true } }),
    db.project.findMany({ select: { id: true, cohortId: true, submissions: true } }),
    optionalLinkTargets(db),
  ]);

  const cohortById = new Map(cohorts.map((c) => [c.id, c]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const feedbackBySession = new Map<string, typeof feedback>();
  for (const f of feedback) {
    const list = feedbackBySession.get(f.sessionId) ?? [];
    list.push(f);
    feedbackBySession.set(f.sessionId, list);
  }
  const held = sessions.filter((s) => s.status === "COMPLETED");

  // 1. Attendance <= learners
  const attendance: Violation[] = [];
  for (const s of held) {
    const c = cohortById.get(s.cohortId)!;
    if (s.attendance == null)
      attendance.push({ recordId: s.id, detail: "Completed session has no attendance" });
    else if (s.attendance < 0 || s.attendance > c.enrolledLearners)
      attendance.push({ recordId: s.id, detail: `Attendance ${s.attendance} vs ${c.enrolledLearners} enrolled in ${c.code}` });
  }

  // 2. Feedback per session is plausible for attendance
  const perSession: Violation[] = [];
  for (const s of held) {
    const n = feedbackBySession.get(s.id)?.length ?? 0;
    const att = s.attendance ?? 0;
    if (n > att) {
      perSession.push({ recordId: s.id, detail: `${n} feedback rows but only ${att} attended` });
      continue;
    }
    const rate = att === 0 ? 0 : n / att;
    if (rate < RESPONSE_RATE_BAND.min || rate > RESPONSE_RATE_BAND.max)
      perSession.push({ recordId: s.id, detail: `Response rate ${(rate * 100).toFixed(0)}% (${n}/${att}) outside ${RESPONSE_RATE_BAND.min * 100}–${RESPONSE_RATE_BAND.max * 100}%` });
  }

  // 3. Feedback per cohort is plausible for cohort size
  const perCohort: Violation[] = [];
  const learnersByCohort = new Map<string, Set<string>>();
  for (const f of feedback) {
    const c = cohortById.get(f.cohortId);
    const s = sessionById.get(f.sessionId);
    if (!c || !s || s.cohortId !== f.cohortId) {
      perCohort.push({ recordId: f.id, detail: "Feedback cohort does not match its session's cohort" });
      continue;
    }
    const m = f.learnerId.match(/^(.+)-L(\d+)$/);
    if (!m || m[1] !== c.code || Number(m[2]) < 1 || Number(m[2]) > c.enrolledLearners)
      perCohort.push({ recordId: f.id, detail: `Learner ${f.learnerId} is not one of ${c.enrolledLearners} enrolled in ${c.code}` });
    const set = learnersByCohort.get(c.id) ?? new Set<string>();
    set.add(f.learnerId);
    learnersByCohort.set(c.id, set);
  }
  for (const c of cohorts) {
    const distinct = learnersByCohort.get(c.id)?.size ?? 0;
    if (distinct > c.enrolledLearners)
      perCohort.push({ recordId: c.id, detail: `${distinct} distinct respondents but ${c.enrolledLearners} enrolled` });
  }

  // 4. Rating is consistent with sentiment
  const sentiment: Violation[] = [];
  for (const f of feedback) {
    if (!Number.isInteger(f.rating) || f.rating < 1 || f.rating > 5)
      sentiment.push({ recordId: f.id, detail: `Rating ${f.rating} outside 1–5` });
    else if (f.sentiment !== sentimentForRating(f.rating))
      sentiment.push({ recordId: f.id, detail: `Rating ${f.rating} labeled ${f.sentiment}, expected ${sentimentForRating(f.rating)}` });
  }

  // 5. Stored averages match the feedback they summarize
  const derived: Violation[] = [];
  for (const s of sessions) {
    const avg = mean((feedbackBySession.get(s.id) ?? []).map((f) => f.rating));
    const expected = avg == null ? null : round2(avg);
    if (expected == null ? s.avgRating != null : s.avgRating == null || Math.abs(s.avgRating - expected) > RATING_TOLERANCE)
      derived.push({ recordId: s.id, detail: `Session avgRating ${s.avgRating ?? "null"}, feedback mean ${expected ?? "null"}` });
  }
  for (const ins of instructors) {
    const avgs = sessions.filter((s) => s.instructorId === ins.id && s.avgRating != null).map((s) => s.avgRating!);
    const m = mean(avgs);
    const expected = m == null ? null : round2(m);
    if (expected == null ? ins.rating != null : ins.rating == null || Math.abs(ins.rating - expected) > RATING_TOLERANCE)
      derived.push({ recordId: ins.id, detail: `${ins.name} rating ${ins.rating ?? "null"}, session mean ${expected ?? "null"}` });
  }

  // 6. Sessions fall inside their cohort window, and status agrees with the date
  const timing: Violation[] = [];
  for (const s of sessions) {
    const c = cohortById.get(s.cohortId)!;
    if (s.scheduledAt < c.startDate || s.scheduledAt > c.endDate)
      timing.push({ recordId: s.id, detail: `${fmtDate(s.scheduledAt)} outside ${c.code} window` });
    const future = s.scheduledAt >= DEMO_TODAY;
    if (future && s.status !== "SCHEDULED")
      timing.push({ recordId: s.id, detail: `Future session marked ${s.status}` });
    if (!future && s.status === "SCHEDULED")
      timing.push({ recordId: s.id, detail: "Past session still SCHEDULED" });
  }

  // 7. Only held sessions carry outcomes; feedback arrives after the session
  const outcomes: Violation[] = [];
  for (const s of sessions) {
    if (s.status === "COMPLETED") continue;
    const n = feedbackBySession.get(s.id)?.length ?? 0;
    if (s.attendance != null || s.avgRating != null || n > 0)
      outcomes.push({ recordId: s.id, detail: `${s.status} session has attendance/rating/${n} feedback` });
  }
  for (const f of feedback) {
    const s = sessionById.get(f.sessionId)!;
    if (f.createdAt < s.scheduledAt || f.createdAt > DEMO_TODAY)
      outcomes.push({ recordId: f.id, detail: `Submitted ${fmtDate(f.createdAt)}, session at ${fmtDate(s.scheduledAt)}` });
  }

  // 8. Headcounts stay within capacity
  const headcount: Violation[] = [];
  for (const c of cohorts) {
    if (c.enrolledLearners > c.capacity)
      headcount.push({ recordId: c.id, detail: `${c.code}: ${c.enrolledLearners} enrolled > capacity ${c.capacity}` });
    if (c.capacity >= MAX_LEARNERS)
      headcount.push({ recordId: c.id, detail: `${c.code}: capacity ${c.capacity} ≥ ${MAX_LEARNERS}` });
  }
  for (const p of projects) {
    const c = cohortById.get(p.cohortId)!;
    if (p.submissions > c.enrolledLearners)
      headcount.push({ recordId: p.id, detail: `${p.submissions} submissions > ${c.enrolledLearners} learners` });
  }

  // 9. Optional links stay inside the workspace (required ones are enforced by foreign keys)
  const crossWorkspace: Violation[] = [];
  const linkCheck = (recordId: string, label: string, id: string | null, targets: Set<string>) => {
    if (id != null && !targets.has(id)) crossWorkspace.push({ recordId, detail: `${label} ${id} is not in this workspace` });
  };
  for (const s of sessions) {
    linkCheck(s.id, "Module", s.moduleId, links.modules);
    linkCheck(s.id, "Guest SME", s.smeId, links.smes);
  }
  for (const m of links.moduleReviewers) linkCheck(m.id, "Reviewer", m.reviewerId, links.smes);
  for (const i of links.issueLinks) {
    linkCheck(i.id, "Course", i.courseId, links.courses);
    linkCheck(i.id, "Cohort", i.cohortId, new Set(cohorts.map((c) => c.id)));
    linkCheck(i.id, "Session", i.sessionId, new Set(sessions.map((s) => s.id)));
  }
  for (const l of links.launchCohorts) linkCheck(l.id, "Cohort", l.cohortId, new Set(cohorts.map((c) => c.id)));
  const linkCount = sessions.length + links.moduleReviewers.length + links.issueLinks.length + links.launchCohorts.length;

  return [
    check("attendance", "Attendance ≤ enrolled learners", "Every completed session's attendance is between 0 and its cohort's enrolled learners.", held.length, "completed sessions", attendance),
    check("feedback-per-session", "Feedback count fits attendance", `Feedback rows per session ≤ attendance, response rate ${RESPONSE_RATE_BAND.min * 100}–${RESPONSE_RATE_BAND.max * 100}%.`, held.length, "completed sessions", perSession),
    check("feedback-per-cohort", "Feedback fits cohort size", "Respondents are enrolled learners of the session's cohort; distinct respondents ≤ enrolled.", feedback.length, "feedback rows", perCohort),
    check("rating-sentiment", "Rating matches sentiment", "4–5 → positive, 3 → neutral, 1–2 → negative.", feedback.length, "feedback rows", sentiment),
    check("derived-ratings", "Stored ratings match feedback", "Session avgRating = mean of its feedback; instructor rating = mean of their sessions (±0.005).", sessions.length + instructors.length, "sessions + instructors", derived),
    check("session-timing", "Sessions inside cohort window", "Sessions fall between cohort start and end; past ones aren't SCHEDULED, future ones are.", sessions.length, "sessions", timing),
    check("outcomes", "No outcomes before a session happens", "Only completed sessions have attendance, ratings or feedback; feedback is submitted after the session.", sessions.length + feedback.length, "sessions + feedback", outcomes),
    check("headcount", "Headcount within capacity", `Enrolled ≤ capacity < ${MAX_LEARNERS}; project submissions ≤ enrolled.`, cohorts.length + projects.length, "cohorts + projects", headcount),
    check("workspace-links", "Links stay inside the workspace", "Optional links (session module/SME, module reviewer, issue course/cohort/session, launch cohort) point at records in this workspace.", linkCount, "records with optional links", crossWorkspace),
  ];
}

// Ids in this workspace, plus every optional link, for check 9.
async function optionalLinkTargets(db: ReturnType<typeof scopedDb>) {
  const [modules, smes, courses, moduleReviewers, issueLinks, launchCohorts] = await Promise.all([
    db.module.findMany({ select: { id: true } }),
    db.sME.findMany({ select: { id: true } }),
    db.course.findMany({ select: { id: true } }),
    db.module.findMany({ select: { id: true, reviewerId: true } }),
    db.issue.findMany({ select: { id: true, courseId: true, cohortId: true, sessionId: true } }),
    db.launch.findMany({ select: { id: true, cohortId: true } }),
  ]);
  const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
  return { modules: ids(modules), smes: ids(smes), courses: ids(courses), moduleReviewers, issueLinks, launchCohorts };
}
