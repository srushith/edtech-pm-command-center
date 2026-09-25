// Deterministic, internally consistent mock data for the Command Center.
//
// Determinism: a seeded PRNG (mulberry32) and a fixed anchor date stand in for
// Math.random() and Date.now(); ids are derived, not generated. Same input, same rows.
//
// Consistency is by construction. Integrity checks on /data verify it:
//   attendance <= enrolled learners <= capacity < 100
//   feedback rows per session <= attendance, within RESPONSE_RATE_BAND
//   sentiment = sentimentForRating(rating)
//   Session.avgRating and Instructor.rating are computed from feedback, never drawn
//   past sessions have attendance, future ones don't

import "dotenv/config";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../lib/generated/prisma/client";
import type {
  CohortStatus,
  HealthStatus,
  HiringStage,
  IssueStatus,
  LaunchStatus,
  ModuleStage,
  Prisma,
  Region,
  SessionStatus,
} from "../lib/generated/prisma/client";
import { mean, round2, sentimentForRating } from "../lib/domain/feedback";
import { DEMO_TODAY } from "../lib/domain/time";
import * as F from "./seed-data";

const ANCHOR = DEMO_TODAY;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const addHours = (d: Date, n: number) => new Date(d.getTime() + n * HOUR);
const minDate = (a: Date, b: Date) => (a < b ? a : b);
const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY;

// ---------- Seeded randomness ----------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260925);
const between = (min: number, max: number) => min + rand() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;
function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function normal() {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".");

// ---------- Planted signals (for later phases to detect) ----------

// Specific sessions that went badly, keyed "<cohortCode>#<sessionNumber>".
const PROBLEM_SESSIONS: Record<string, { quality: number; theme: string }> = {
  "TGA-C1#7": { quality: 2.3, theme: "audio" },
  "AIE-C1#9": { quality: 2.5, theme: "clarity" },
};
const WEAK_INSTRUCTOR_COHORT = "AAI-C2"; // its lead instructor rates ~3.2, pacing complaints
const CANCELLED_SESSIONS = new Set(["PM-C1#4", "EM-C1#3"]);
const SCHEDULE_HORIZON_DAYS = 28; // sessions are scheduled up to 4 weeks ahead

// Curriculum work in flight that isn't being taught yet.
const PIPELINE_MODULES: { course: string; title: string; stage: ModuleStage }[] = [
  { course: "AAI", title: "Agent Security & Red Teaming", stage: "PLANNED" },
  { course: "TGA", title: "Responsible AI for Leaders", stage: "DRAFTING" },
];
const FDE_MODULE_STAGES: ModuleStage[] = ["SME_REVIEW", "DRAFTING"];

const CHANGELOGS = [
  "Refreshed code samples for latest SDK",
  "Added hands-on lab and solution walkthrough",
  "Reworked slides based on cohort feedback",
  "New case study from industry partner",
  "Fixed errata in quiz and notebook",
  "Split long lecture into two shorter segments",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = new PrismaClient({ adapter: new PrismaLibSql({ url }) });

  // ---------- People ----------
  const namePairs = shuffle(F.FIRST_NAMES.flatMap((f) => F.LAST_NAMES.map((l) => `${f} ${l}`)));
  const usedFirst = new Set<string>();
  const people: string[] = [];
  for (const name of namePairs) {
    // Unique first names keep the demo readable.
    const first = name.split(" ")[0];
    if (usedFirst.has(first)) continue;
    usedFirst.add(first);
    people.push(name);
  }
  // 40 unique first names; add a second pass for the remainder.
  for (const name of namePairs) {
    if (people.length >= 54) break;
    if (!people.includes(name)) people.push(name);
  }

  const instructorStages: HiringStage[] = [
    ...Array<HiringStage>(16).fill("ACTIVE"),
    "SOURCED", "SCREENING", "INTERVIEW", "TRIAL_SESSION", "OFFER", "INACTIVE",
  ];
  const regions: Region[] = ["US", "INDIA", "GLOBAL"];
  const instructors = instructorStages.map((stage, i) => {
    const name = people[i];
    return {
      id: `ins_${String(i + 1).padStart(2, "0")}`,
      name,
      email: `${slug(name)}@instructors.example.com`,
      expertise: shuffle(F.INSTRUCTOR_EXPERTISE).slice(0, int(2, 3)).join(","),
      region: regions[i % 3],
      rating: null as number | null,
      hiringStage: stage,
      joinedAt: addDays(ANCHOR, stage === "ACTIVE" || stage === "INACTIVE" ? -int(60, 900) : -int(1, 20)),
    };
  });
  const activeInstructors = instructors.filter((i) => i.hiringStage === "ACTIVE");

  const smeStages: HiringStage[] = [
    ...Array<HiringStage>(22).fill("ACTIVE"),
    "SOURCED", "SOURCED", "SOURCED", "SCREENING", "SCREENING",
    "INTERVIEW", "INTERVIEW", "TRIAL_SESSION", "OFFER", "INACTIVE",
  ];
  const smes = smeStages.map((stage, i) => {
    const name = people[instructors.length + i];
    return {
      id: `sme_${String(i + 1).padStart(2, "0")}`,
      name,
      email: `${slug(name)}@sme.example.com`,
      domain: pick(F.SME_DOMAINS),
      company: pick(F.SME_COMPANIES),
      hoursPerWeek: int(2, 10),
      hiringStage: stage,
    };
  });
  const activeSmes = smes.filter((s) => s.hiringStage === "ACTIVE");

  // ---------- Courses & cohorts ----------
  const courses = F.COURSES.map((c, i) => ({
    id: `crs_${c.code.toLowerCase()}`,
    code: c.code,
    name: c.name,
    region: c.region,
    track: c.track,
    status: c.inDevelopment ? ("IN_DEVELOPMENT" as const) : ("ACTIVE" as const),
    createdAt: addDays(ANCHOR, c.inDevelopment ? -90 : -500 + i * 30),
  }));
  const courseByCode = new Map(courses.map((c) => [c.code, c]));

  const cohorts = F.COHORTS.map((c) => {
    const course = courseByCode.get(c.course)!;
    const startDate = addDays(ANCHOR, c.startOffset);
    const endDate = addDays(startDate, c.weeks * 7);
    const status: CohortStatus =
      endDate < ANCHOR ? "COMPLETED" : startDate > ANCHOR ? "UPCOMING" : "ACTIVE";
    const fill = status === "UPCOMING" ? between(0.45, 0.8) : between(0.78, 0.97);
    return {
      id: `coh_${c.course.toLowerCase()}_${c.n}`,
      code: `${c.course}-C${c.n}`,
      name: `${course.name} · Cohort ${c.n}`,
      courseId: course.id,
      startDate,
      endDate,
      capacity: c.capacity,
      enrolledLearners: Math.floor(c.capacity * fill),
      status,
      health: "HEALTHY" as HealthStatus, // derived from session ratings below
      weeks: c.weeks,
      courseCode: c.course,
      region: course.region,
    };
  });

  // ---------- Modules & versions ----------
  const modules: Prisma.ModuleCreateManyInput[] = [];
  const versions: Prisma.ModuleVersionCreateManyInput[] = [];
  const publishedByCourse = new Map<string, { id: string; title: string }[]>();
  const contentOwners = ["Content: Mei", "Content: Arun", "Srushith"];

  function addModule(courseCode: string, title: string, order: number, stage: ModuleStage) {
    const id = `mod_${courseCode.toLowerCase()}_${order}`;
    const published = stage === "PUBLISHED";
    const versionCount = published ? int(2, 4) : stage === "PLANNED" ? 0 : 1;
    const labels = published ? ["v1.0", "v1.1", "v1.2", "v2.0"] : ["v0.1"];
    // Walk backwards from the newest version so every date is in the past.
    let at = addDays(ANCHOR, -int(1, 40));
    const vs: Prisma.ModuleVersionCreateManyInput[] = [];
    for (let v = versionCount - 1; v >= 0; v--) {
      vs.unshift({
        id: `${id}_v${v}`,
        moduleId: id,
        version: labels[v],
        changelog: v === 0 ? "Initial version" : pick(CHANGELOGS),
        authorName: pick(contentOwners),
        createdAt: at,
      });
      at = addDays(at, -int(15, 60));
    }
    versions.push(...vs);
    // The FDE module stuck in SME review is overdue: a curriculum bottleneck signal.
    const overdue = courseCode === "FDE" && stage === "SME_REVIEW";
    modules.push({
      id,
      courseId: courseByCode.get(courseCode)!.id,
      title,
      order,
      stage,
      ownerName: pick(contentOwners),
      reviewerId: pick(activeSmes).id,
      dueDate: overdue
        ? addDays(ANCHOR, -4)
        : addDays(ANCHOR, published ? -int(20, 200) : int(10, 60)),
      updatedAt: vs.length ? (vs[vs.length - 1].createdAt as Date) : addDays(ANCHOR, -int(5, 20)),
    });
    if (published) {
      const list = publishedByCourse.get(courseCode) ?? [];
      list.push({ id, title });
      publishedByCourse.set(courseCode, list);
    }
  }

  for (const [courseCode, titles] of Object.entries(F.MODULES)) {
    titles.forEach((title, i) =>
      addModule(courseCode, title, i + 1, courseCode === "FDE" ? FDE_MODULE_STAGES[i] : "PUBLISHED"),
    );
  }
  for (const p of PIPELINE_MODULES) {
    addModule(p.course, p.title, F.MODULES[p.course].length + 1, p.stage);
  }

  // ---------- Sessions & feedback ----------
  type SessionRow = Prisma.SessionCreateManyInput & { key: string; feedbackCount: number };
  const sessions: SessionRow[] = [];
  const feedback: Prisma.LearnerFeedbackCreateManyInput[] = [];
  // Each cohort gets a lead and a second instructor, round-robin over active instructors.
  const instructorPool = shuffle(activeInstructors);
  const teaching = cohorts.map((_, i) => ({
    lead: instructorPool[(2 * i) % instructorPool.length],
    second: instructorPool[(2 * i + 1) % instructorPool.length],
  }));
  const weakInstructorId = teaching[cohorts.findIndex((c) => c.code === WEAK_INSTRUCTOR_COHORT)].lead.id;

  for (const [ci, cohort] of cohorts.entries()) {
    const { lead, second } = teaching[ci];
    const mods = publishedByCourse.get(cohort.courseCode) ?? [];
    if (mods.length === 0) continue;
    const cohortQuality = between(4.0, 4.5);
    const startOffset = daysBetween(ANCHOR, cohort.startDate);
    const hourUtc = cohort.region === "INDIA" ? 13.5 : 16; // 7pm IST / noon ET

    for (let week = 0; week < cohort.weeks; week++) {
      const dayOffset = startOffset + 2 + week * 7;
      if (dayOffset > SCHEDULE_HORIZON_DAYS) break;
      const n = week + 1;
      const key = `${cohort.code}#${n}`;
      const id = `ses_${cohort.code.toLowerCase().replace("-", "_")}_${String(n).padStart(2, "0")}`;
      const scheduledAt = addHours(addDays(ANCHOR, dayOffset), hourUtc);
      const mod = mods[Math.min(mods.length - 1, Math.floor((week * mods.length) / cohort.weeks))];
      const instructor = week % 3 === 2 ? second : lead;
      const status: SessionStatus =
        scheduledAt >= ANCHOR ? "SCHEDULED" : CANCELLED_SESSIONS.has(key) ? "CANCELLED" : "COMPLETED";

      const row: SessionRow = {
        id,
        key,
        cohortId: cohort.id,
        moduleId: mod.id,
        instructorId: instructor.id,
        smeId: chance(0.2) ? pick(activeSmes).id : null,
        title: `${mod.title} — Week ${n}`,
        scheduledAt,
        durationMin: pick([60, 90, 90, 120]),
        status,
        attendance: null,
        avgRating: null,
        recordingUrl: null,
        feedbackCount: 0,
      };

      if (status === "COMPLETED") {
        const problem = PROBLEM_SESSIONS[key];
        const weak = instructor.id === weakInstructorId;
        const quality = problem?.quality ?? (weak ? 3.2 : cohortQuality + between(-0.2, 0.2));
        const biasTheme = problem?.theme ?? (weak ? "pacing" : null);

        const attendance = Math.round(
          cohort.enrolledLearners * (problem ? between(0.45, 0.6) : between(0.6, 0.95)),
        );
        const responses = Math.max(3, Math.round(attendance * between(0.12, 0.25)));
        const learners = shuffle(Array.from({ length: cohort.enrolledLearners }, (_, i) => i + 1)).slice(0, responses);
        const ratings: number[] = [];

        for (const learnerNo of learners) {
          const rating = Math.min(5, Math.max(1, Math.round(quality + normal() * 0.75)));
          const sentiment = sentimentForRating(rating);
          const theme =
            sentiment === "NEGATIVE" && biasTheme && chance(0.75) ? biasTheme : pick(F.THEMES[sentiment]);
          ratings.push(rating);
          feedback.push({
            id: `fb_${String(feedback.length + 1).padStart(5, "0")}`,
            sessionId: id,
            cohortId: cohort.id,
            learnerId: `${cohort.code}-L${String(learnerNo).padStart(3, "0")}`,
            rating,
            sentiment,
            theme,
            comment: pick(F.COMMENTS[sentiment][theme]),
            createdAt: minDate(addHours(scheduledAt, int(1, 36)), addHours(ANCHOR, -1)),
          });
        }

        row.attendance = attendance;
        row.avgRating = round2(mean(ratings)!);
        row.recordingUrl = `https://recordings.example.com/${id}`;
        row.feedbackCount = ratings.length;
      }
      sessions.push(row);
    }
  }

  // Derived: instructor rating = mean of their completed sessions' averages.
  for (const ins of instructors) {
    const avgs = sessions
      .filter((s) => s.instructorId === ins.id && s.avgRating != null)
      .map((s) => s.avgRating as number);
    const m = mean(avgs);
    ins.rating = m == null ? null : round2(m);
  }

  // Derived: cohort health from the mean of its last 3 rated sessions.
  for (const cohort of cohorts) {
    const recent = sessions
      .filter((s) => s.cohortId === cohort.id && s.avgRating != null)
      .slice(-3)
      .map((s) => s.avgRating as number);
    const m = mean(recent);
    cohort.health = m == null ? "HEALTHY" : m < 3.5 ? "CRITICAL" : m < 4.0 ? "ATTENTION" : "HEALTHY";
  }

  // ---------- Issues ----------
  const sessionByKey = new Map(sessions.map((s) => [s.key, s]));
  const cohortByCode = new Map(cohorts.map((c) => [c.code, c]));
  const runningCohorts = cohorts.filter((c) => c.status !== "UPCOMING");
  const weakSession = sessions.find((s) => s.instructorId === weakInstructorId && s.avgRating != null)!;

  // Issues tied to planted signals, by template title.
  const pinned: Record<string, { cohort: string; sessionKey?: string; status: IssueStatus }> = {
    "Zoom audio dropouts during live session": { cohort: "TGA-C1", sessionKey: "TGA-C1#7", status: "IN_PROGRESS" },
    "Learners report instructor pace too fast": { cohort: WEAK_INSTRUCTOR_COHORT, sessionKey: weakSession.key, status: "OPEN" },
    "Explanations confusing in evaluation module": { cohort: "AIE-C1", sessionKey: "AIE-C1#9", status: "OPEN" },
    "Time-zone clash with India cohort office hours": { cohort: "TGA-C2", status: "OPEN" },
    "API credits exhausted for lab accounts": { cohort: "AIE-C1", status: "BLOCKED" },
  };

  const issues: Prisma.IssueCreateManyInput[] = F.ISSUE_TEMPLATES.map((t, i) => {
    const pin = pinned[t.title];
    const cohort = pin ? cohortByCode.get(pin.cohort)! : runningCohorts[i % runningCohorts.length];
    const session = pin?.sessionKey ? sessionByKey.get(pin.sessionKey)! : null;

    let openedAt: Date;
    if (session) {
      openedAt = minDate(addHours(session.scheduledAt as Date, int(2, 20)), addHours(ANCHOR, -1));
    } else {
      const since = Math.max(1, Math.floor(daysBetween(cohort.startDate, ANCHOR)) + 7);
      const lookback = cohort.status === "UPCOMING" ? int(1, 10) : int(1, Math.min(40, since));
      openedAt = addHours(addDays(ANCHOR, -lookback), -int(1, 12));
    }

    const status: IssueStatus =
      pin?.status ??
      (cohort.status === "COMPLETED"
        ? "RESOLVED"
        : pick(["RESOLVED", "RESOLVED", "RESOLVED", "OPEN", "OPEN", "IN_PROGRESS", "IN_PROGRESS", "BLOCKED"] as const));
    const resolvedAt =
      status === "RESOLVED"
        ? addDays(openedAt, between(0.2, Math.min(10, daysBetween(openedAt, ANCHOR))))
        : null;
    // A few open issues have no owner: an "Assign owner" signal for the home page.
    const unowned = status === "OPEN" && !pin && chance(0.6);

    return {
      id: `iss_${101 + i}`,
      code: `ISS-${101 + i}`,
      title: t.title,
      category: t.category,
      severity: t.severity,
      status,
      ownerName: unowned ? null : pick(F.PM_TEAM),
      courseId: cohort.courseId,
      cohortId: cohort.id,
      sessionId: session?.id ?? null,
      openedAt,
      resolvedAt,
    };
  });

  // ---------- Projects ----------
  const projects: Prisma.ProjectCreateManyInput[] = [];
  for (const cohort of runningCohorts) {
    const kinds: ("PROJECT" | "CAPSTONE")[] = cohort.weeks >= 10 ? ["PROJECT", "CAPSTONE"] : ["PROJECT"];
    for (const type of kinds) {
      const dueDate =
        type === "PROJECT"
          ? addDays(cohort.startDate, Math.floor(cohort.weeks * 3.5))
          : addDays(cohort.endDate, -3);
      const opensAt = addDays(dueDate, -21);
      let status: Prisma.ProjectCreateManyInput["status"];
      let submissions = 0;
      let avgScore: number | null = null;
      if (dueDate <= ANCHOR) {
        submissions = Math.round(cohort.enrolledLearners * between(0.8, 0.97));
        if (dueDate < addDays(ANCHOR, -10)) {
          status = "COMPLETED";
          avgScore = Math.round(between(68, 88) * 10) / 10;
        } else status = "GRADING";
      } else if (opensAt <= ANCHOR) {
        status = "IN_PROGRESS";
        submissions = Math.round(cohort.enrolledLearners * between(0, 0.15));
      } else status = "NOT_STARTED";

      const course = courseByCode.get(cohort.courseCode)!;
      projects.push({
        id: `prj_${cohort.code.toLowerCase().replace("-", "_")}_${type.toLowerCase()}`,
        title: `${course.name} ${type === "CAPSTONE" ? "Capstone" : "Mid-program Project"}`,
        type,
        status,
        courseId: course.id,
        cohortId: cohort.id,
        dueDate,
        submissions,
        avgScore,
      });
    }
  }

  // ---------- Launches & checklists ----------
  const launchDefs: { name: string; course: string; cohort?: string; offset?: number; status: LaunchStatus; owner: string }[] = [
    { name: "Transformative GenAI · Cohort 2", course: "TGA", cohort: "TGA-C2", status: "ON_TRACK", owner: "Srushith" },
    { name: "Forward Deployed Engineering · Cohort 1", course: "FDE", cohort: "FDE-C1", status: "AT_RISK", owner: "Srushith" },
    { name: "Agentic AI · Cohort 2", course: "AAI", cohort: "AAI-C2", status: "LAUNCHED", owner: "Program: Lisa" },
    { name: "Software Engineering · Cohort 1", course: "SWE", cohort: "SWE-C1", status: "LAUNCHED", owner: "Program: Lisa" },
    { name: "Agentic AI v2 curriculum refresh", course: "AAI", offset: 60, status: "PLANNING", owner: "Content: Mei" },
    { name: "Engineering Management · Cohort 2", course: "EM", offset: 75, status: "PLANNING", owner: "Srushith" },
  ];
  // Overdue, not-done items that make the FDE launch at risk.
  const AT_RISK_BLOCKERS = new Set(["Instructors contracted", "Curriculum modules published"]);

  const launches: Prisma.LaunchCreateManyInput[] = [];
  const checklist: Prisma.ChecklistItemCreateManyInput[] = [];
  launchDefs.forEach((l, i) => {
    const cohort = l.cohort ? cohortByCode.get(l.cohort)! : null;
    const targetDate = cohort ? cohort.startDate : addDays(ANCHOR, l.offset!);
    const id = `lch_${i + 1}`;
    launches.push({
      id,
      name: l.name,
      courseId: courseByCode.get(l.course)!.id,
      cohortId: cohort?.id ?? null,
      targetDate,
      status: l.status,
      ownerName: l.owner,
    });
    F.CHECKLIST_TEMPLATE.forEach((item, j) => {
      const dueDate = addDays(targetDate, -item.daysBefore);
      const past = dueDate < ANCHOR;
      const done =
        l.status === "LAUNCHED" || (past && !(l.status === "AT_RISK" && AT_RISK_BLOCKERS.has(item.label)));
      checklist.push({
        id: `${id}_chk_${j + 1}`,
        launchId: id,
        label: item.label,
        ownerName: item.owner,
        dueDate,
        done,
        doneAt: done ? minDate(addDays(dueDate, -int(0, 3)), addHours(ANCHOR, -1)) : null,
      });
    });
  });

  // ---------- Activity log ("What changed") ----------
  type Event = Omit<Prisma.ActivityEventCreateManyInput, "id" | "createdAt"> & { createdAt: Date };
  const events: Event[] = [];
  const recent = (d: Date | null | undefined, days: number) =>
    !!d && d <= ANCHOR && d >= addDays(ANCHOR, -days);

  for (const iss of issues) {
    if (recent(iss.openedAt as Date, 14))
      events.push({ entityType: "Issue", entityId: iss.id!, action: "opened", summary: `${iss.code} opened: ${iss.title}`, actorName: iss.ownerName ?? "System", createdAt: iss.openedAt as Date });
    if (recent(iss.resolvedAt as Date | null, 14))
      events.push({ entityType: "Issue", entityId: iss.id!, action: "resolved", summary: `${iss.code} resolved: ${iss.title}`, actorName: iss.ownerName ?? "System", createdAt: iss.resolvedAt as Date });
  }
  const moduleById = new Map(modules.map((m) => [m.id!, m]));
  for (const v of versions) {
    if (recent(v.createdAt as Date, 30))
      events.push({ entityType: "Module", entityId: v.moduleId, action: "version_published", summary: `${moduleById.get(v.moduleId)!.title} ${v.version}: ${v.changelog}`, actorName: v.authorName, createdAt: v.createdAt as Date });
  }
  for (const s of sessions) {
    if (s.avgRating != null && s.avgRating < 3.5 && recent(s.scheduledAt as Date, 21)) {
      const last = feedback.filter((f) => f.sessionId === s.id).reduce((a, f) => ((f.createdAt as Date) > a ? (f.createdAt as Date) : a), s.scheduledAt as Date);
      events.push({ entityType: "Session", entityId: s.id!, action: "low_rating", summary: `${s.title} rated ${s.avgRating.toFixed(2)} from ${s.feedbackCount} responses`, actorName: "System", createdAt: last });
    }
  }
  for (const c of checklist) {
    if (c.done && recent(c.doneAt as Date, 14)) {
      const launch = launches.find((l) => l.id === c.launchId)!;
      events.push({ entityType: "Launch", entityId: launch.id!, action: "checklist_done", summary: `${launch.name}: "${c.label}" done`, actorName: c.ownerName, createdAt: c.doneAt as Date });
    }
  }
  for (const ins of instructors) {
    if (ins.hiringStage !== "ACTIVE" && ins.hiringStage !== "INACTIVE")
      events.push({ entityType: "Instructor", entityId: ins.id, action: "stage_changed", summary: `${ins.name} moved to ${ins.hiringStage.replace("_", " ").toLowerCase()}`, actorName: "Srushith", createdAt: ins.joinedAt });
  }
  for (const c of cohorts) {
    if (recent(c.startDate, 30))
      events.push({ entityType: "Cohort", entityId: c.id, action: "started", summary: `${c.name} started with ${c.enrolledLearners} learners`, actorName: "System", createdAt: c.startDate });
  }
  events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.summary.localeCompare(b.summary));
  const activity = events.map((e, i) => ({ ...e, id: `evt_${String(i + 1).padStart(3, "0")}` }));

  // ---------- Write ----------
  // Children first so foreign keys never dangle mid-reset.
  await db.activityEvent.deleteMany();
  await db.checklistItem.deleteMany();
  await db.launch.deleteMany();
  await db.project.deleteMany();
  await db.issue.deleteMany();
  await db.learnerFeedback.deleteMany();
  await db.session.deleteMany();
  await db.moduleVersion.deleteMany();
  await db.module.deleteMany();
  await db.cohort.deleteMany();
  await db.course.deleteMany();
  await db.sME.deleteMany();
  await db.instructor.deleteMany();

  await db.instructor.createMany({ data: instructors });
  await db.sME.createMany({ data: smes });
  await db.course.createMany({ data: courses });
  await db.cohort.createMany({
    data: cohorts.map(({ weeks: _w, courseCode: _c, region: _r, ...c }) => c),
  });
  await db.module.createMany({ data: modules });
  await db.moduleVersion.createMany({ data: versions });
  await db.session.createMany({ data: sessions.map(({ key: _k, feedbackCount: _f, ...s }) => s) });
  await db.learnerFeedback.createMany({ data: feedback });
  await db.issue.createMany({ data: issues });
  await db.project.createMany({ data: projects });
  await db.launch.createMany({ data: launches });
  await db.checklistItem.createMany({ data: checklist });
  await db.activityEvent.createMany({ data: activity });

  console.log("Seeded (anchor %s):", ANCHOR.toISOString().slice(0, 10));
  console.table({
    courses: courses.length,
    cohorts: cohorts.length,
    instructors: instructors.length,
    smes: smes.length,
    modules: modules.length,
    moduleVersions: versions.length,
    sessions: sessions.length,
    feedback: feedback.length,
    issues: issues.length,
    projects: projects.length,
    launches: launches.length,
    checklistItems: checklist.length,
    activityEvents: activity.length,
  });
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
