// Workspace isolation and roles: a user can't read or change another workspace's
// records, viewers can't write, and only owners manage the workspace.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { db } from "@/lib/db";
import { acceptPendingInvites, contextFor, isSignInAllowed, type WorkspaceContext } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/roles";
import { getFilterOptions } from "@/lib/data/filters";
import { getRecordCounts, runIntegrityChecks } from "@/lib/data/integrity";
import { scopedDb } from "@/lib/data/scoped";
import { getFocusedEntity, getSearchIndex } from "@/lib/data/search";
import {
  changeRole,
  clearDemoData,
  countDemoData,
  getWorkspaceSettings,
  inviteMember,
  removeMember,
  renameWorkspace,
  revokeInvite,
} from "@/lib/data/workspaces";
import { ctx, makeUser, makeWorkspace, resetDb } from "./helpers";

// Two workspaces with identical demo data (same codes), so leaks can only be told apart by id.
let alice: { id: string }; // owner of A
let bob: { id: string }; // owner of B
let vera: { id: string }; // viewer in A
let ed: { id: string }; // editor in A
let wsA: { id: string };
let wsB: { id: string };
let aOwner: WorkspaceContext;
let aViewer: WorkspaceContext;
let aEditor: WorkspaceContext;
let bOwner: WorkspaceContext;
let bCourseId: string;
let bCohortId: string;

const inB = (id: string) => id.startsWith(`${wsB.id}_`);
const rejectsAccess = (p: Promise<unknown>) => assert.rejects(p, AccessError);

before(async () => {
  await resetDb();
  [alice, bob, vera, ed] = await Promise.all([
    makeUser("alice@a.test"), makeUser("bob@b.test"), makeUser("vera@a.test"), makeUser("ed@a.test"),
  ]);
  wsA = await makeWorkspace(alice.id, "A", { demo: true, members: [[vera.id, "VIEWER"], [ed.id, "EDITOR"]] });
  wsB = await makeWorkspace(bob.id, "B", { demo: true });
  [aOwner, aViewer, aEditor, bOwner] = await Promise.all([
    ctx(alice.id, wsA.id), ctx(vera.id, wsA.id), ctx(ed.id, wsA.id), ctx(bob.id, wsB.id),
  ]);
  const bCourse = await scopedDb(bOwner).course.findFirstOrThrow({ where: { code: "AIE" } });
  bCourseId = bCourse.id;
  bCohortId = (await scopedDb(bOwner).cohort.findFirstOrThrow({ where: { code: "AIE-C1" } })).id;
});
after(() => db.$disconnect());

describe("membership gate", () => {
  test("no context for a workspace you're not a member of", async () => {
    await rejectsAccess(contextFor(alice.id, wsB.id));
    await rejectsAccess(contextFor(bob.id, wsA.id));
  });
});

describe("a member of A cannot read B's records", () => {
  test("search index holds only A's records", async () => {
    const index = await getSearchIndex(aOwner);
    assert.ok(index.length > 500, "A's demo data is indexed");
    assert.equal(index.filter((i) => inB(i.id)).length, 0);
    assert.ok(index.every((i) => i.id.startsWith(`${wsA.id}_`)));
  });

  test("focusing B's record by id finds nothing", async () => {
    assert.equal(await getFocusedEntity(aOwner, `course:${bCourseId}`), null);
    assert.ok(await getFocusedEntity(bOwner, `course:${bCourseId}`));
  });

  test("filter options, counts and integrity checks cover A only", async () => {
    const opts = await getFilterOptions(aOwner);
    assert.equal(opts.courses.length, 8);
    assert.equal(opts.cohorts.length, 10);
    const counts = Object.fromEntries((await getRecordCounts(aOwner)).map((c) => [c.entity, c.count]));
    assert.equal(counts.Course, 8, "B's 8 courses aren't counted");
    const checks = await runIntegrityChecks(aOwner);
    assert.ok(checks.every((c) => c.passed), checks.filter((c) => !c.passed).map((c) => c.id).join(", "));
    assert.ok(checks.every((c) => c.violations.every((v) => !inB(v.recordId))));
  });

  test("direct reads by B's id return nothing", async () => {
    const a = scopedDb(aOwner);
    assert.equal(await a.course.findUnique({ where: { id: bCourseId } }), null);
    assert.equal(await a.course.findFirst({ where: { id: bCourseId } }), null);
    assert.equal(await a.cohort.count({ where: { id: bCohortId } }), 0);
    // Even an explicit workspaceId filter is overridden by the scope.
    assert.equal(await a.course.count({ where: { workspaceId: wsB.id } }), 8);
    assert.equal((await a.course.findMany({ where: { workspaceId: wsB.id } })).filter((c) => inB(c.id)).length, 0);
  });

  test("settings of B aren't visible from A", async () => {
    const s = await getWorkspaceSettings(aOwner);
    assert.ok(s.members.every((m) => m.userId !== bob.id));
  });
});

describe("a member of A cannot edit B's records", () => {
  test("update and delete by B's id fail and leave B unchanged", async () => {
    const a = scopedDb(aOwner);
    await assert.rejects(a.course.update({ where: { id: bCourseId }, data: { name: "Hijacked" } }));
    assert.equal((await a.course.updateMany({ where: { id: bCourseId }, data: { name: "Hijacked" } })).count, 0);
    await assert.rejects(a.issue.delete({ where: { id: `${wsB.id}_iss_101` } }));
    assert.equal((await a.learnerFeedback.deleteMany({ where: { cohortId: bCohortId } })).count, 0);
    const bCourse = await scopedDb(bOwner).course.findUniqueOrThrow({ where: { id: bCourseId } });
    assert.equal(bCourse.name, "AI Engineering");
    assert.equal(await scopedDb(bOwner).issue.count({ where: { id: `${wsB.id}_iss_101` } }), 1);
  });

  test("creates are stamped with A even when B's workspaceId is passed", async () => {
    const row = await scopedDb(aEditor).instructor.create({
      data: { workspaceId: wsB.id, name: "Planted", email: "planted@x.test", expertise: "rag", region: "US", hiringStage: "SOURCED", joinedAt: new Date() },
    });
    assert.equal(row.workspaceId, wsA.id);
    assert.equal(await scopedDb(bOwner).instructor.count({ where: { email: "planted@x.test" } }), 0);
    await scopedDb(aEditor).instructor.delete({ where: { id: row.id } });
  });

  test("the database rejects a record in A that points at B's parent", async () => {
    await assert.rejects(
      db.cohort.create({
        data: {
          workspaceId: wsA.id, courseId: bCourseId, code: "X-1", name: "Cross", startDate: new Date(), endDate: new Date(),
          capacity: 10, enrolledLearners: 5, status: "UPCOMING", health: "HEALTHY",
        },
      }),
    );
  });

  test("owner operations on B's members and invites fail from A", async () => {
    await rejectsAccess(changeRole(aOwner, bob.id, "VIEWER"));
    await rejectsAccess(removeMember(aOwner, bob.id));
    const invite = await inviteMember(bOwner, "someone@b.test", "EDITOR");
    await rejectsAccess(revokeInvite(aOwner, invite.id));
    assert.equal(await db.invite.count({ where: { id: invite.id } }), 1);
  });

  test("clearing A's demo data leaves B's intact", async () => {
    const bBefore = await countDemoData(bOwner);
    const extra = await makeWorkspace(alice.id, "A2", { demo: true });
    const a2 = await ctx(alice.id, extra.id);
    assert.ok((await clearDemoData(a2)) > 600);
    assert.equal(await countDemoData(a2), 0);
    assert.equal(await countDemoData(bOwner), bBefore);
  });

  test("the scoped client has no raw SQL or account tables", async () => {
    const a = scopedDb(aOwner) as unknown as Record<string, { findMany?: () => Promise<unknown> }>;
    await rejectsAccess(Promise.resolve().then(() => a.membership.findMany!()));
    await rejectsAccess(Promise.resolve().then(() => scopedDb(aOwner).$queryRawUnsafe("SELECT 1")));
  });
});

describe("roles", () => {
  test("viewers can read but not write", async () => {
    const v = scopedDb(aViewer);
    assert.equal(await v.course.count(), 8);
    await rejectsAccess(v.course.update({ where: { id: `${wsA.id}_crs_aie` }, data: { name: "x" } }));
    await rejectsAccess(v.course.updateMany({ data: { name: "x" } }));
    await rejectsAccess(v.issue.deleteMany({}));
    await rejectsAccess(v.instructor.create({
      data: { workspaceId: wsA.id, name: "x", email: "x@x.test", expertise: "", region: "US", hiringStage: "SOURCED", joinedAt: new Date() },
    }));
  });

  test("editors can write records but not manage the workspace", async () => {
    const e = scopedDb(aEditor);
    await e.issue.update({ where: { id: `${wsA.id}_iss_101` }, data: { status: "RESOLVED" } });
    await rejectsAccess(renameWorkspace(aEditor, "Mine now"));
    await rejectsAccess(inviteMember(aEditor, "friend@x.test", "OWNER"));
    await rejectsAccess(changeRole(aEditor, ed.id, "OWNER"));
    await rejectsAccess(clearDemoData(aEditor));
  });

  test("viewers can't manage the workspace either", async () => {
    await rejectsAccess(renameWorkspace(aViewer, "x"));
    await rejectsAccess(removeMember(aViewer, alice.id));
  });

  test("the last owner can't be removed or demoted", async () => {
    await rejectsAccess(changeRole(aOwner, alice.id, "EDITOR"));
    await rejectsAccess(removeMember(aOwner, alice.id));
  });

  test("a removed member loses access immediately", async () => {
    const temp = await makeUser("temp@a.test");
    await db.membership.create({ data: { userId: temp.id, workspaceId: wsA.id, role: "EDITOR" } });
    await ctx(temp.id, wsA.id);
    await removeMember(aOwner, temp.id);
    await rejectsAccess(contextFor(temp.id, wsA.id));
  });
});

describe("invite-only sign-in", () => {
  test("admins, members and invitees may sign in; strangers may not", async () => {
    process.env.ALLOWED_EMAILS = "Admin@Example.com, other@example.com";
    assert.equal(await isSignInAllowed("admin@example.com"), true, "admin, case-insensitive");
    assert.equal(await isSignInAllowed("vera@a.test"), true, "existing member");
    assert.equal(await isSignInAllowed("stranger@x.test"), false);
    await inviteMember(aOwner, "New.Person@X.test", "VIEWER");
    assert.equal(await isSignInAllowed("new.person@x.test"), true, "pending invite");
  });

  test("expired invites don't count", async () => {
    await inviteMember(aOwner, "late@x.test", "VIEWER", new Date("2020-01-01"));
    assert.equal(await isSignInAllowed("late@x.test"), false);
  });

  test("signing in turns pending invites into memberships with the invited role", async () => {
    await inviteMember(aOwner, "joiner@x.test", "EDITOR");
    const joiner = await makeUser("joiner@x.test");
    assert.equal(await acceptPendingInvites(joiner.id, "Joiner@X.test"), 1);
    const c = await contextFor(joiner.id, wsA.id);
    assert.equal(c.role, "EDITOR");
    await assert.rejects(contextFor(joiner.id, wsB.id), AccessError);
  });
});
