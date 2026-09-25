// Creating and editing records: consistency rules, derived values, activity log,
// search freshness, roles and workspace isolation.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { db } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/roles";
import { runIntegrityChecks } from "@/lib/data/integrity";
import { getRecordForEdit, saveRecord, type SaveResult } from "@/lib/data/records";
import { scopedDb } from "@/lib/data/scoped";
import { getSearchIndex } from "@/lib/data/search";
import type { Values } from "@/lib/records/kit";
import { RECORDS, RECORD_TYPES } from "@/lib/records/registry";
import { ctx, makeUser, makeWorkspace, resetDb } from "./helpers";

// A fixed clock, well after the demo anchor, so date rules are deterministic.
const NOW = new Date("2026-09-26T12:00:00Z");
const iso = (s: string) => new Date(s).toISOString();

let owner: WorkspaceContext; // A (empty)
let editor: WorkspaceContext; // A
let viewer: WorkspaceContext; // A
let other: WorkspaceContext; // B (demo data)
let wsB: string;

function ok(r: SaveResult): string {
  assert.equal(r.ok, true, r.ok ? "" : JSON.stringify(r.errors));
  return (r as { id: string }).id;
}
function fails(r: SaveResult, field: string, pattern?: RegExp) {
  assert.equal(r.ok, false, `expected an error on ${field}`);
  const msg = (r as { errors: Record<string, string> }).errors[field];
  assert.ok(msg, `no error on ${field}: ${JSON.stringify((r as { errors: object }).errors)}`);
  if (pattern) assert.match(msg, pattern);
}
const save = (c: WorkspaceContext, type: Parameters<typeof saveRecord>[1], values: Values, id: string | null = null) =>
  saveRecord(c, type, id, values, NOW);

// Fixtures created in A through the real write path.
let courseId: string;
let cohortId: string; // 40 enrolled, 2026-09-01 .. 2026-11-30
let moduleId: string;
let instructorId: string;
let sessionId: string; // completed, attendance 10

const course = (over: Values = {}) => ({ code: "RAG", name: "Retrieval Systems", region: "US", track: "AI", status: "ACTIVE", description: "RAG end to end.", ...over });
const cohort = (over: Values = {}) => ({
  courseId, code: "RAG-C1", name: "Retrieval Systems · Cohort 1", startDate: "2026-09-01", endDate: "2026-11-30",
  capacity: "50", enrolledLearners: "40", health: "HEALTHY", ...over,
});
const session = (over: Values = {}) => ({
  cohortId, moduleId, instructorId, smeId: "", title: "Chunking & embeddings — Week 3",
  scheduledAt: iso("2026-09-20T16:00:00Z"), durationMin: "90", status: "COMPLETED", attendance: "10", avgRating: "", ...over,
});
const feedback = (over: Values = {}) => ({
  sessionId, learnerNumber: "1", rating: "2", theme: "pacing", comment: "RAG part was rushed.", createdAt: iso("2026-09-21T10:00:00Z"), ...over,
});

before(async () => {
  await resetDb();
  const [o, e, v, b] = await Promise.all([makeUser("o@a.test", "Olivia"), makeUser("e@a.test"), makeUser("v@a.test"), makeUser("b@b.test")]);
  const wsA = await makeWorkspace(o.id, "A", { members: [[e.id, "EDITOR"], [v.id, "VIEWER"]] });
  const B = await makeWorkspace(b.id, "B", { demo: true });
  wsB = B.id;
  [owner, editor, viewer, other] = await Promise.all([ctx(o.id, wsA.id), ctx(e.id, wsA.id), ctx(v.id, wsA.id), ctx(b.id, B.id)]);

  courseId = ok(await save(owner, "course", course()));
  cohortId = ok(await save(owner, "cohort", cohort()));
  moduleId = ok(await save(owner, "module", {
    courseId, title: "Chunking & embeddings", description: "Splitting documents and embedding them.", tags: "RAG, Embeddings",
    stage: "PUBLISHED", ownerName: "Olivia", reviewerId: "", dueDate: "2026-10-01",
  }));
  instructorId = ok(await save(owner, "instructor", {
    name: "Ada Lovelace", email: "Ada@Example.com", expertise: "rag, evals", region: "US", hiringStage: "ACTIVE", joinedAt: "2026-01-10",
  }));
  sessionId = ok(await save(editor, "session", session()));
});
after(() => db.$disconnect());

describe("consistency rules", () => {
  test("a cohort needs a course from this workspace", async () => {
    fails(await save(owner, "cohort", cohort({ courseId: "", code: "X-1" })), "courseId", /Choose a course/);
    const bCourse = await scopedDb(other).course.findFirstOrThrow();
    fails(await save(owner, "cohort", cohort({ courseId: bCourse.id, code: "X-2" })), "courseId", /doesn't exist in this workspace/);
  });

  test("dates must be valid and in order", async () => {
    fails(await save(owner, "cohort", cohort({ code: "X-3", endDate: "2026-08-01" })), "endDate", /on or after the start/);
    fails(await save(owner, "cohort", cohort({ code: "X-4", startDate: "2026-02-30" })), "startDate", /isn't a valid date/);
    fails(await save(owner, "session", session({ scheduledAt: "tomorrow" })), "scheduledAt", /valid date and time/);
  });

  test("enrolled can't exceed capacity, and capacity stays under 100", async () => {
    fails(await save(owner, "cohort", cohort({ code: "X-5", enrolledLearners: "60" })), "enrolledLearners", /can't exceed capacity/);
    fails(await save(owner, "cohort", cohort({ code: "X-6", capacity: "120" })), "capacity", /between 1 and 99/);
  });

  test("attendance can't exceed the cohort's learners", async () => {
    fails(await save(owner, "session", session({ attendance: "41" })), "attendance", /can't exceed the 40 learners in RAG-C1/);
    fails(await save(owner, "session", session({ attendance: "" })), "attendance", /required for a completed session/);
  });

  test("sessions stay inside the cohort window, and status agrees with the date", async () => {
    fails(await save(owner, "session", session({ scheduledAt: iso("2026-12-05T16:00:00Z") })), "scheduledAt", /Must fall within RAG-C1/);
    fails(await save(owner, "session", session({ scheduledAt: iso("2026-10-05T16:00:00Z") })), "status", /future session can't be completed/);
    fails(await save(owner, "session", session({ status: "SCHEDULED", attendance: "" })), "status", /date has passed/);
    // The end date is inclusive.
    ok(await save(owner, "session", session({ scheduledAt: iso("2026-11-30T18:00:00Z"), status: "SCHEDULED", attendance: "", title: "Last day" })));
  });

  test("a session's module must belong to its cohort's course", async () => {
    const otherCourse = ok(await save(owner, "course", course({ code: "EVL", name: "Evals" })));
    const foreignModule = ok(await save(owner, "module", {
      courseId: otherCourse, title: "Offline evals", description: "Eval sets.", tags: "", stage: "PLANNED", ownerName: "Olivia", reviewerId: "", dueDate: "2026-10-10",
    }));
    fails(await save(owner, "session", session({ moduleId: foreignModule })), "moduleId", /different course than RAG-C1/);
  });

  test("feedback needs a completed session with room for it", async () => {
    const scheduled = ok(await save(owner, "session", session({ scheduledAt: iso("2026-10-20T16:00:00Z"), status: "SCHEDULED", attendance: "", title: "Future" })));
    fails(await save(owner, "feedback", feedback({ sessionId: scheduled })), "sessionId", /completed session/);
    fails(await save(owner, "feedback", feedback({ learnerNumber: "41" })), "learnerNumber", /has 40 learners/);
    fails(await save(owner, "feedback", feedback({ createdAt: iso("2026-09-19T10:00:00Z") })), "createdAt", /before the session started/);
    const tiny = ok(await save(owner, "session", session({ attendance: "1", title: "Tiny" })));
    ok(await save(owner, "feedback", feedback({ sessionId: tiny })));
    fails(await save(owner, "feedback", feedback({ sessionId: tiny, learnerNumber: "2" })), "sessionId", /1 feedback entries for 1 attendees/);
  });

  test("issues: links must chain and resolution must follow opening", async () => {
    const base = {
      title: "Embeddings API rate limits", description: "Labs hit 429s.", category: "TECHNICAL", severity: "HIGH", status: "RESOLVED",
      ownerName: "", courseId: "", cohortId: "", sessionId, openedAt: iso("2026-09-21T09:00:00Z"),
    };
    fails(await save(owner, "issue", { ...base, resolvedAt: iso("2026-09-20T09:00:00Z") }), "resolvedAt", /can't be before opened/);
    fails(await save(owner, "issue", { ...base, resolvedAt: "" }), "resolvedAt", /When was it resolved/);
    const evl = await scopedDb(owner).course.findFirstOrThrow({ where: { code: "EVL" } });
    fails(await save(owner, "issue", { ...base, courseId: evl.id, cohortId, resolvedAt: iso("2026-09-22T09:00:00Z") }), "cohortId", /isn't a cohort of EVL/);
    // Picking only a session fills in its cohort and course.
    const id = ok(await save(owner, "issue", { ...base, resolvedAt: iso("2026-09-22T09:00:00Z") }));
    const issue = await scopedDb(owner).issue.findUniqueOrThrow({ where: { id } });
    assert.equal(issue.cohortId, cohortId);
    assert.equal(issue.courseId, courseId);
    assert.match(issue.code, /^ISS-\d+$/);
  });

  test("projects: cohort of the course, due inside the cohort, submissions within learners", async () => {
    const base = { courseId, cohortId, title: "RAG assistant", description: "Build one.", type: "PROJECT", status: "IN_PROGRESS", dueDate: "2026-10-15", submissions: "5", avgScore: "" };
    fails(await save(owner, "project", { ...base, dueDate: "2027-01-10" }), "dueDate", /Must fall within RAG-C1/);
    fails(await save(owner, "project", { ...base, submissions: "45" }), "submissions", /Can't exceed the 40 learners/);
    fails(await save(owner, "project", { ...base, status: "COMPLETED" }), "avgScore", /needs its average score/);
    ok(await save(owner, "project", base));
  });

  test("uniqueness: course codes and emails are unique within a workspace", async () => {
    fails(await save(owner, "course", course({ name: "Dup" })), "code", /already uses RAG/);
    fails(await save(owner, "instructor", {
      name: "Dup", email: "ada@example.com", expertise: "rag", region: "US", hiringStage: "ACTIVE", joinedAt: "2026-01-10",
    }), "email", /already uses ada@example.com/);
    // Workspace B can use the same code: uniqueness is per workspace.
    ok(await save(other, "course", course()));
  });

  test("editing a cohort can't strand its sessions or feedback", async () => {
    fails(await save(owner, "cohort", cohort({ enrolledLearners: "5" }), cohortId), "enrolledLearners", /At least 10/);
    fails(await save(owner, "cohort", cohort({ endDate: "2026-09-10" }), cohortId), "endDate", /would fall outside these dates/);
  });
});

describe("derived values", () => {
  test("feedback sets sentiment, the learner id, and recomputes session and instructor ratings", async () => {
    // A manual survey average is allowed while the session has no feedback...
    const s = ok(await save(owner, "session", session({ title: "Manual", avgRating: "4.5", attendance: "20" })));
    let row = await scopedDb(owner).session.findUniqueOrThrow({ where: { id: s } });
    assert.equal(row.avgRating, 4.5);
    // ...then feedback takes over.
    const f1 = ok(await save(owner, "feedback", feedback({ sessionId: s, learnerNumber: "3", rating: "2" })));
    ok(await save(owner, "feedback", feedback({ sessionId: s, learnerNumber: "4", rating: "5" })));
    row = await scopedDb(owner).session.findUniqueOrThrow({ where: { id: s } });
    assert.equal(row.avgRating, 3.5);
    const fb = await scopedDb(owner).learnerFeedback.findUniqueOrThrow({ where: { id: f1 } });
    assert.equal(fb.learnerId, "RAG-C1-L003");
    assert.equal(fb.sentiment, "NEGATIVE");
    assert.equal(fb.cohortId, cohortId);
    // Editing a rating recomputes.
    ok(await save(owner, "feedback", feedback({ sessionId: s, learnerNumber: "3", rating: "4" }), f1));
    row = await scopedDb(owner).session.findUniqueOrThrow({ where: { id: s } });
    assert.equal(row.avgRating, 4.5);
    // The manual rating is now locked.
    fails(await save(owner, "session", session({ title: "Manual", avgRating: "1", attendance: "20" }), s), "avgRating", /computed from it/);
    // And the session can't stop being completed.
    fails(await save(owner, "session", session({ title: "Manual", status: "CANCELLED", attendance: "" }), s), "status", /must stay completed/);
    const ins = await scopedDb(owner).instructor.findUniqueOrThrow({ where: { id: instructorId } });
    const rated = await scopedDb(owner).session.findMany({ where: { instructorId, avgRating: { not: null } } });
    assert.equal(ins.rating, Math.round((rated.reduce((a, r) => a + r.avgRating!, 0) / rated.length) * 100) / 100);
  });

  test("cohort status follows the dates; a new launch gets the standard checklist", async () => {
    const c = await scopedDb(owner).cohort.findUniqueOrThrow({ where: { id: cohortId } });
    assert.equal(c.status, "ACTIVE");
    const l = ok(await save(owner, "launch", { name: "Retrieval Systems · Cohort 2", courseId, cohortId: "", targetDate: "2027-01-15", status: "PLANNING", ownerName: "Olivia" }));
    const items = await scopedDb(owner).checklistItem.findMany({ where: { launchId: l } });
    assert.equal(items.length, 7);
    assert.ok(items.every((i) => i.ownerName === "Olivia" && !i.done && i.dueDate < new Date("2027-01-15")));
  });
});

describe("activity log and search", () => {
  test("creates and edits log an ActivityEvent with a readable summary", async () => {
    const id = ok(await save(owner, "sme", { name: "Grace Hopper", email: "grace@x.test", domain: "RAG & Retrieval", company: "Navy", hoursPerWeek: "4", hiringStage: "SOURCED" }));
    ok(await save(owner, "sme", { name: "Grace Hopper", email: "grace@x.test", domain: "RAG & Retrieval", company: "Navy", hoursPerWeek: "6", hiringStage: "ACTIVE" }, id));
    const events = await scopedDb(owner).activityEvent.findMany({ where: { entityId: id }, orderBy: { id: "asc" } });
    assert.deepEqual(events.map((e) => e.action).sort(), ["created", "status_changed"]);
    const upd = events.find((e) => e.action === "status_changed")!;
    assert.match(upd.summary, /Olivia updated SME Grace Hopper: Hours per week 4 → 6; Hiring stage Sourced → Active/);
    assert.equal(upd.actorName, "Olivia");
    // Saving without changes logs nothing.
    ok(await save(owner, "sme", { name: "Grace Hopper", email: "grace@x.test", domain: "RAG & Retrieval", company: "Navy", hoursPerWeek: "6", hiringStage: "ACTIVE" }, id));
    assert.equal(await scopedDb(owner).activityEvent.count({ where: { entityId: id } }), 2);
  });

  test("every record type logs its creation", async () => {
    const types = new Set((await scopedDb(owner).activityEvent.findMany({ where: { action: "created" } })).map((e) => e.entityType));
    for (const t of ["Course", "Cohort", "Module", "Instructor", "Session", "LearnerFeedback", "Issue", "Project", "Launch", "SME"]) {
      assert.ok(types.has(t), `no created event for ${t}`);
    }
  });

  test("new records are in the search index right away", async () => {
    const index = await getSearchIndex(owner);
    for (const [type, id] of [["course", courseId], ["cohort", cohortId], ["module", moduleId], ["instructor", instructorId], ["session", sessionId]] as const) {
      assert.ok(index.some((i) => i.type === type && i.id === id), `${type} ${id} missing from search`);
    }
    assert.ok(index.some((i) => i.label === "RAG-C1"));
  });
});

describe("roles and isolation", () => {
  test("viewers can't create or edit any record type", async () => {
    for (const type of RECORD_TYPES) {
      await assert.rejects(saveRecord(viewer, type, null, RECORDS[type].defaults?.({ courses: [], cohorts: [], modules: [], instructors: [], smes: [], sessions: [] }, NOW) ?? {}, NOW), AccessError, type);
    }
    await assert.rejects(saveRecord(viewer, "course", courseId, course({ name: "Mine" }), NOW), AccessError);
    assert.equal((await scopedDb(owner).course.findUniqueOrThrow({ where: { id: courseId } })).name, "Retrieval Systems");
  });

  test("editing another workspace's record by id finds nothing and changes nothing", async () => {
    const bCourse = await scopedDb(other).course.findFirstOrThrow({ where: { code: "AIE" } });
    const r = await save(editor, "course", course({ code: "AIE", name: "Hijacked" }), bCourse.id);
    fails(r, "_form", /doesn't exist in this workspace/);
    assert.equal((await scopedDb(other).course.findUniqueOrThrow({ where: { id: bCourse.id } })).name, "AI Engineering");
    assert.equal(await getRecordForEdit(editor, "course", bCourse.id), null);
  });

  test("records reference only this workspace (B's session can't take A's instructor)", async () => {
    const bSession = await scopedDb(other).session.findFirstOrThrow({ where: { status: "SCHEDULED" } });
    const values = (await getRecordForEdit(other, "session", bSession.id))!;
    fails(await saveRecord(other, "session", bSession.id, { ...values, instructorId }, new Date("2026-09-25T00:00:00Z")), "instructorId", /doesn't exist in this workspace/);
    assert.ok(bSession.id.startsWith(wsB));
  });

  test("the integrity checks still pass after all these edits", async () => {
    const checks = await runIntegrityChecks(owner, NOW);
    const failing = checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.violations.map((v) => v.detail).join("; ")}`);
    assert.deepEqual(failing, []);
  });
});
