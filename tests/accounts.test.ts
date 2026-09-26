// Deleting your own account: only-owner workspaces go with it, shared ones are left
// (and logged there), pending invites go, the Google grant is revoked.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { db } from "@/lib/db";
import { AccessError } from "@/lib/auth/roles";
import { encryptSecret } from "@/lib/crypto";
import { deleteAccount, inviteMember, planAccountDeletion } from "@/lib/data/workspaces";
import type { Fetch } from "@/lib/google/sheets";
import { ctx, makeUser, makeWorkspace, resetDb } from "./helpers";

const NOW = new Date("2026-09-26T12:00:00Z");

let dana: { id: string }; // deletes her account
let sam: { id: string };
let solo: { id: string }; // Dana is the only owner (Sam is an editor there)
let shared: { id: string }; // Dana and Sam both own it
let guest: { id: string }; // Sam owns it; Dana is a viewer
let other: { id: string }; // unrelated, with demo data

before(async () => {
  await resetDb();
  [dana, sam] = await Promise.all([makeUser("dana@x.test", "Dana"), makeUser("sam@x.test", "Sam")]);
  solo = await makeWorkspace(dana.id, "Dana's", { demo: true, members: [[sam.id, "EDITOR"]] });
  shared = await makeWorkspace(dana.id, "Shared", { members: [[sam.id, "OWNER"]] });
  guest = await makeWorkspace(sam.id, "Sam's", { members: [[dana.id, "VIEWER"]] });
  other = await makeWorkspace(sam.id, "Other", { demo: true });
  await inviteMember(await ctx(sam.id, other.id), "dana@x.test", "EDITOR", NOW);
  await db.account.create({
    data: {
      userId: dana.id, type: "oidc", provider: "google", providerAccountId: "g-dana",
      refresh_token: encryptSecret("r-dana", "google-refresh-token"), access_token: "a-dana", scope: "openid email",
    },
  });
});
after(() => db.$disconnect());

describe("deleting your account", () => {
  test("the plan names the workspaces that would be deleted and the ones you'd leave", async () => {
    const plan = await planAccountDeletion(dana.id);
    assert.deepEqual(plan.deletes, [{ id: solo.id, name: "Dana's", otherMembers: 1 }]);
    assert.deepEqual(plan.leaves.map((w) => w.name).sort(), ["Sam's", "Shared"]);
  });

  test("it needs your own email typed", async () => {
    await assert.rejects(deleteAccount(dana.id, "sam@x.test", { now: NOW }), AccessError);
    assert.ok(await db.user.findUnique({ where: { id: dana.id } }));
  });

  test("deletes only-owner workspaces, leaves shared ones (logged), revokes Google access", async () => {
    const otherCourses = await db.course.count({ where: { workspaceId: other.id } });
    const revoked: string[] = [];
    const fakeFetch: Fetch = async (input, init) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/revoke")) revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
      return new Response("{}", { status: 200 });
    };
    await deleteAccount(dana.id, " Dana@X.test ", { fetchImpl: fakeFetch, now: NOW });

    assert.deepEqual(revoked, ["r-dana"]);
    assert.equal(await db.user.count({ where: { id: dana.id } }), 0);
    assert.equal(await db.account.count({ where: { userId: dana.id } }), 0);
    assert.equal(await db.membership.count({ where: { userId: dana.id } }), 0);
    assert.equal(await db.invite.count({ where: { email: "dana@x.test" } }), 0);

    assert.equal(await db.workspace.count({ where: { id: solo.id } }), 0, "Dana was its only owner");
    assert.equal(await db.course.count({ where: { workspaceId: solo.id } }), 0);
    assert.equal(await db.membership.count({ where: { workspaceId: solo.id } }), 0, "Sam loses access to it");

    for (const w of [shared, guest]) {
      assert.equal(await db.workspace.count({ where: { id: w.id } }), 1);
      const ev = await db.activityEvent.findFirstOrThrow({ where: { workspaceId: w.id, action: "member_left" } });
      assert.equal(ev.summary, "Dana deleted their account and left the workspace");
    }
    assert.equal(await db.membership.count({ where: { workspaceId: shared.id, role: "OWNER" } }), 1, "Sam still owns Shared");
    assert.equal(await db.course.count({ where: { workspaceId: other.id } }), otherCourses);
  });
});
