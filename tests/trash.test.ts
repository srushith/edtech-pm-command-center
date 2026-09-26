// Trash: cascade previews and typed confirmation, soft delete hidden everywhere, undo,
// owner-only restore/purge/empty, restore order, instructors blocked (mark inactive
// instead), derived ratings, 30-day expiry, and an ActivityEvent for every step.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { db } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/roles";
import { getFilterOptions } from "@/lib/data/filters";
import { getRecordCounts, runIntegrityChecks } from "@/lib/data/integrity";
import { getFormOptions, getRecordForEdit, listRecords, saveRecord, setInstructorsInactive } from "@/lib/data/records";
import { onlyTrash, scopedDb } from "@/lib/data/scoped";
import { getSearchIndex } from "@/lib/data/search";
import {
  deleteForever, deleteRecords, emptyTrash, listTrash, previewDelete, purgeExpiredTrash,
  restoreFromTrash, TRASH_DAYS, undoDelete, UNDO_WINDOW_MS,
} from "@/lib/data/trash";
import { ctx, makeUser, makeWorkspace, resetDb } from "./helpers";

const NOW = new Date("2026-09-26T12:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
const DAY = 86_400_000;
const rejectsAccess = (p: Promise<unknown>, re?: RegExp) => assert.rejects(p, (e: unknown) => e instanceof AccessError && (!re || re.test(e.message)));

let owner: WorkspaceContext;
let editor: WorkspaceContext;
let editor2: WorkspaceContext;
let viewer: WorkspaceContext;

async function allChecksPass(c: WorkspaceContext) {
  const failed = (await runIntegrityChecks(c, NOW)).filter((x) => !x.passed);
  assert.deepEqual(failed.map((x) => `${x.id}: ${x.violations[0]?.detail}`), []);
}

before(async () => {
  await resetDb();
  const [o, e, e2, v] = await Promise.all([makeUser("o@a.test", "Olivia"), makeUser("e@a.test", "Eli"), makeUser("e2@a.test", "Erin"), makeUser("v@a.test")]);
  const ws = await makeWorkspace(o.id, "A", { demo: true, members: [[e.id, "EDITOR"], [e2.id, "EDITOR"], [v.id, "VIEWER"]] });
  [owner, editor, editor2, viewer] = await Promise.all([ctx(o.id, ws.id), ctx(e.id, ws.id), ctx(e2.id, ws.id), ctx(v.id, ws.id)]);
});
after(() => db.$disconnect());

describe("deleting a course", () => {
  let course: { id: string; code: string; name: string };
  let batchId: string;
  let expected: { cohorts: number; sessions: number; feedback: number; issueLinks: number };

  before(async () => {
    const s = scopedDb(owner);
    course = await s.course.findFirstOrThrow({ where: { code: "AIE" } });
    const cohortIds = (await s.cohort.findMany({ where: { courseId: course.id }, select: { id: true } })).map((c) => c.id);
    expected = {
      cohorts: cohortIds.length,
      sessions: await s.session.count({ where: { cohortId: { in: cohortIds } } }),
      feedback: await s.learnerFeedback.count({ where: { cohortId: { in: cohortIds } } }),
      issueLinks: await s.issue.count({ where: { courseId: course.id } }),
    };
    assert.ok(expected.cohorts > 0 && expected.sessions > 0 && expected.feedback > 0, "demo course has a subtree");
  });

  test("the preview lists what goes with it and asks for the course name", async () => {
    const p = await previewDelete(editor, "course", [course.id]);
    const n = (label: string) => p.removes.find((r) => r.label === label)?.count ?? 0;
    assert.equal(n("cohorts") + n("cohort"), expected.cohorts);
    assert.equal(n("sessions"), expected.sessions);
    assert.equal(n("feedback entries"), expected.feedback);
    assert.equal(p.confirmText, course.name);
    assert.deepEqual(p.blocked, []);
    if (expected.issueLinks) assert.ok(p.unlinks.some((u) => /lose their course link/.test(u.label)));
  });

  test("without the typed name nothing is deleted", async () => {
    await rejectsAccess(deleteRecords(editor, "course", [course.id], null, NOW), /Type the name/);
    await rejectsAccess(deleteRecords(editor, "course", [course.id], "AIE", NOW));
    assert.ok(await scopedDb(owner).course.findUnique({ where: { id: course.id } }));
  });

  test("with it, the subtree moves to Trash in one batch and is logged", async () => {
    const r = await deleteRecords(editor, "course", [course.id], `  ${course.name.toUpperCase()} `, NOW);
    batchId = r.batchId;
    assert.ok(r.count >= 1 + expected.cohorts + expected.sessions + expected.feedback);
    const trashed = await db.course.findUniqueOrThrow({ where: { id: course.id } });
    assert.ok(trashed.deletedAt);
    assert.equal(trashed.trashBatchId, batchId);
    assert.equal(await db.cohort.count({ where: { courseId: course.id, trashBatchId: batchId } }), expected.cohorts);
    const ev = await scopedDb(owner).activityEvent.findFirstOrThrow({ where: { action: "deleted", entityId: course.id } });
    assert.match(ev.summary, new RegExp(`^Eli moved course AIE .* to Trash with \\d+ cohort`));
  });

  test("trashed records are gone from tables, search, pickers, filters, counts and edits", async () => {
    const cohortIds = (await db.cohort.findMany({ where: { courseId: course.id }, select: { id: true } })).map((c) => c.id);
    const gone = new Set([course.id, ...cohortIds]);
    assert.ok(!(await listRecords(owner, "course", {})).rows.some((r) => gone.has(r.id)));
    assert.ok(!(await listRecords(owner, "cohort", {})).rows.some((r) => gone.has(r.id)));
    assert.ok(!(await getSearchIndex(owner)).some((i) => gone.has(i.id)));
    const opts = await getFormOptions(owner);
    assert.ok(!opts.courses.some((c) => gone.has(c.id)) && !opts.cohorts.some((c) => gone.has(c.id)));
    assert.ok(!opts.sessions.some((s) => cohortIds.includes(s.cohortId)));
    const filters = await getFilterOptions(owner);
    assert.equal(filters.courses.length, 7);
    assert.ok(!filters.courses.some((c) => c.code === "AIE"));
    const counts = await getRecordCounts(owner);
    assert.equal(counts.find((c) => c.entity === "Course")!.count, 7);
    assert.equal(await getRecordForEdit(owner, "course", course.id), null);
    const r = await saveRecord(owner, "course", course.id, { code: "AIE", name: "x", region: "US", track: "x", status: "ACTIVE", description: "x" }, NOW);
    assert.equal(r.ok, false);
    // Issues that pointed at the course stay, without the link.
    assert.equal(await scopedDb(owner).issue.count({ where: { courseId: course.id } }), 0);
    await allChecksPass(owner);
  });

  test("its code stays reserved while it's in Trash", async () => {
    const r = await saveRecord(owner, "course", null, { code: "AIE", name: "New AIE", region: "US", track: "AI", status: "ACTIVE", description: "x" }, NOW);
    assert.equal(r.ok, false);
    assert.match((r as { errors: Record<string, string> }).errors.code, /in Trash/);
  });

  test("another editor can't undo it, and nor can the deleter after 2 minutes", async () => {
    await rejectsAccess(undoDelete(editor2, batchId, later(1000)), /2 minutes/);
    await rejectsAccess(undoDelete(editor, batchId, later(UNDO_WINDOW_MS + 1000)), /ask an owner/);
    await rejectsAccess(undoDelete(viewer, batchId, later(1000)));
  });

  test("the deleter's Undo brings everything back, links included", async () => {
    const r = await undoDelete(editor, batchId, later(30_000));
    assert.match(r.label, /^course AIE/);
    assert.ok(await scopedDb(owner).course.findUnique({ where: { id: course.id } }));
    assert.equal(await scopedDb(owner).cohort.count({ where: { courseId: course.id } }), expected.cohorts);
    assert.equal(await scopedDb(owner).issue.count({ where: { courseId: course.id } }), expected.issueLinks);
    assert.equal(await db.trashBatch.count({ where: { id: batchId } }), 0);
    assert.equal(await db.course.count({ where: { ...onlyTrash } }), 0);
    const ev = await scopedDb(owner).activityEvent.findFirstOrThrow({ where: { action: "restored", entityId: batchId } });
    assert.match(ev.summary, /^Eli undid deleting course AIE/);
    await allChecksPass(owner);
  });
});

describe("roles", () => {
  test("viewers can't preview or delete; editors can't see, restore, purge or empty the Trash", async () => {
    const c = await scopedDb(owner).course.findFirstOrThrow({ where: { code: "PM" } });
    await rejectsAccess(previewDelete(viewer, "course", [c.id]));
    await rejectsAccess(deleteRecords(viewer, "course", [c.id], c.name, NOW));
    const issue = await scopedDb(owner).issue.findFirstOrThrow({});
    const { batchId } = await deleteRecords(editor, "issue", [issue.id], null, NOW);
    await rejectsAccess(listTrash(editor, NOW));
    await rejectsAccess(restoreFromTrash(editor, batchId, NOW));
    await rejectsAccess(deleteForever(editor, batchId, NOW));
    await rejectsAccess(emptyTrash(editor, NOW));
    const items = await listTrash(owner, NOW);
    assert.equal(items.length, 1);
    assert.equal(items[0].daysLeft, TRASH_DAYS);
    assert.equal(items[0].deletedBy, "Eli");
    await restoreFromTrash(owner, batchId, NOW);
    assert.ok(await scopedDb(owner).issue.findUnique({ where: { id: issue.id } }));
  });
});

describe("restoring in order", () => {
  test("a session can't come back while its cohort is in Trash", async () => {
    const s = scopedDb(owner);
    const cohort = await s.cohort.findFirstOrThrow({ where: { code: "PM-C1" } });
    const session = await s.session.findFirstOrThrow({ where: { cohortId: cohort.id } });
    const first = await deleteRecords(owner, "session", [session.id], session.title, NOW);
    const second = await deleteRecords(owner, "cohort", [cohort.id], cohort.code, NOW);
    await rejectsAccess(restoreFromTrash(owner, first.batchId, NOW), /Restore cohort PM-C1 first/);
    await restoreFromTrash(owner, second.batchId, NOW);
    assert.equal(await s.session.count({ where: { id: session.id } }), 0, "the session went in its own delete, so it stays in Trash");
    await restoreFromTrash(owner, first.batchId, NOW);
    assert.equal(await s.session.count({ where: { id: session.id } }), 1);
    await allChecksPass(owner);
  });
});

describe("instructors with sessions", () => {
  test("are blocked, with Mark inactive instead; one without sessions can be deleted", async () => {
    const s = scopedDb(owner);
    const busy = await s.instructor.findFirstOrThrow({ where: { sessions: { some: {} } } });
    const p = await previewDelete(editor, "instructor", [busy.id]);
    assert.equal(p.blocked.length, 1);
    assert.match(p.blocked[0].reason, /^teaches \d+ session/);
    await rejectsAccess(deleteRecords(editor, "instructor", [busy.id], busy.name, NOW), /Mark them inactive/);
    assert.equal(await setInstructorsInactive(editor, [busy.id], NOW), 1);
    assert.equal((await s.instructor.findUniqueOrThrow({ where: { id: busy.id } })).hiringStage, "INACTIVE");
    assert.ok(await s.session.count({ where: { instructorId: busy.id } }), "their sessions stay");

    const idle = await s.instructor.findFirst({ where: { sessions: { none: {} } } });
    if (idle) {
      const q = await previewDelete(editor, "instructor", [idle.id]);
      assert.deepEqual(q.blocked, []);
      assert.equal(q.confirmText, null);
      await deleteRecords(editor, "instructor", [idle.id], null, NOW);
      assert.equal(await s.instructor.count({ where: { id: idle.id } }), 0);
    }
  });
});

describe("derived values", () => {
  test("deleting feedback recomputes session and instructor ratings; restoring puts them back", async () => {
    const s = scopedDb(owner);
    const session = await s.session.findFirstOrThrow({ where: { feedback: { some: {} }, avgRating: { not: null } } });
    const before = { session: session.avgRating, instructor: (await s.instructor.findUniqueOrThrow({ where: { id: session.instructorId } })).rating };
    const ids = (await s.learnerFeedback.findMany({ where: { sessionId: session.id }, select: { id: true } })).map((f) => f.id);
    const r = await deleteRecords(editor, "feedback", ids, null, NOW);
    assert.equal((await s.session.findUniqueOrThrow({ where: { id: session.id } })).avgRating, null, "no feedback left, no rating");
    // (Only the ratings check: a demo session with all its feedback deleted is outside the demo response-rate band.)
    const derived = (await runIntegrityChecks(owner, NOW)).find((c) => c.id === "derived-ratings")!;
    assert.deepEqual(derived.violations, []);
    await undoDelete(editor, r.batchId, later(1000));
    assert.equal((await s.session.findUniqueOrThrow({ where: { id: session.id } })).avgRating, before.session);
    assert.equal((await s.instructor.findUniqueOrThrow({ where: { id: session.instructorId } })).rating, before.instructor);
    await allChecksPass(owner);
  });
});

describe("bulk delete", () => {
  test("several records go as one Trash item; with dependents, you type the count", async () => {
    const s = scopedDb(owner);
    const cohorts = await s.cohort.findMany({ where: { code: { in: ["TPM-C1", "EM-C1"] } } });
    assert.equal(cohorts.length, 2);
    const ids = cohorts.map((c) => c.id);
    const p = await previewDelete(editor, "cohort", ids);
    assert.equal(p.confirmText, "2");
    await rejectsAccess(deleteRecords(editor, "cohort", ids, cohorts[0].code, NOW));
    const r = await deleteRecords(editor, "cohort", ids, "2", NOW);
    assert.match(r.label, /^2 cohorts$/);
    const [item] = (await listTrash(owner, NOW)).filter((i) => i.id === r.batchId);
    assert.equal(item.rootCount, 2);
    await restoreFromTrash(owner, r.batchId, NOW);
    assert.equal(await s.cohort.count({ where: { id: { in: ids } } }), 2);
  });
});

describe("permanent deletion", () => {
  test("Delete forever removes the rows (and trashed rows under them), children first", async () => {
    const s = scopedDb(owner);
    const cohort = await s.cohort.findFirstOrThrow({ where: { code: "SWE-C1" } });
    const session = await s.session.findFirstOrThrow({ where: { cohortId: cohort.id } });
    const first = await deleteRecords(owner, "session", [session.id], session.title, NOW);
    const second = await deleteRecords(owner, "cohort", [cohort.id], cohort.code, NOW);
    await deleteForever(owner, second.batchId, NOW);
    assert.equal(await db.cohort.count({ where: { id: cohort.id } }), 0);
    assert.equal(await db.session.count({ where: { id: session.id } }), 0, "the separately trashed session can't outlive its cohort");
    assert.equal(await db.trashBatch.count({ where: { id: { in: [first.batchId, second.batchId] } } }), 0);
    const ev = await s.activityEvent.findFirstOrThrow({ where: { action: "purged", entityId: second.batchId } });
    assert.match(ev.summary, /^Olivia permanently deleted cohort SWE-C1 from Trash/);
    await allChecksPass(owner);
  });

  test("items expire after 30 days, on the next delete, save, import or Trash view", async () => {
    const issue = await scopedDb(owner).issue.findFirstOrThrow({});
    const r = await deleteRecords(editor, "issue", [issue.id], null, NOW);
    assert.equal(await purgeExpiredTrash(editor, later((TRASH_DAYS - 1) * DAY)), 0);
    assert.equal(await purgeExpiredTrash(viewer, later((TRASH_DAYS + 1) * DAY)), 0, "viewers never write");
    assert.equal((await listTrash(owner, later((TRASH_DAYS + 1) * DAY))).some((i) => i.id === r.batchId), false);
    assert.equal(await db.issue.count({ where: { id: issue.id } }), 0);
    const ev = await scopedDb(owner).activityEvent.findFirstOrThrow({ where: { action: "purged", entityId: r.batchId } });
    assert.match(ev.summary, /after 30 days in Trash/);
  });

  test("Empty Trash purges everything and logs it once", async () => {
    const s = scopedDb(owner);
    const launch = await s.launch.findFirstOrThrow({});
    const items = await s.checklistItem.count({ where: { launchId: launch.id } });
    await deleteRecords(editor, "launch", [launch.id], launch.name, NOW);
    const mod = await s.module.findFirstOrThrow({});
    await deleteRecords(editor, "module", [mod.id], mod.title, NOW);
    const r = await emptyTrash(owner, NOW);
    assert.equal(r.items, 2);
    assert.ok(r.removed >= 2 + items);
    assert.equal(await db.trashBatch.count({ where: { workspaceId: owner.workspace.id } }), 0);
    assert.equal(await db.checklistItem.count({ where: { launchId: launch.id } }), 0);
    assert.match((await s.activityEvent.findFirstOrThrow({ where: { entityType: "Trash", action: "purged" } })).summary, /^Olivia emptied the Trash: 2 items/);
    await allChecksPass(owner);
  });
});
