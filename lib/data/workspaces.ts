// Workspaces, members and invites. These models aren't reachable through scopedDb, so
// every function here checks the caller's role and filters by ctx.workspace itself.
import { db } from "@/lib/db";
import { INVITE_TTL_DAYS, normalizeEmail, requireRole, type WorkspaceContext } from "@/lib/auth/access";
import { AccessError, type Role } from "@/lib/auth/roles";
import { seedDemoData } from "@/lib/demo/seed";
import { deleteAllDomainRows, dropEmptyTrashBatches } from "@/lib/data/trash";
import { revokeGoogleGrant, type Fetch } from "@/lib/google/sheets";

const NAME_MAX = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 86_400_000;

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new AccessError("Workspace name can't be empty.");
  if (n.length > NAME_MAX) throw new AccessError(`Workspace name must be ${NAME_MAX} characters or fewer.`);
  return n;
}

/** Any signed-in user may create a workspace; they become its owner. */
export async function createWorkspace(userId: string, name: string, opts: { demo: boolean }) {
  const workspaceName = cleanName(name);
  return db.$transaction(
    async (tx) => {
      const workspace = await tx.workspace.create({ data: { name: workspaceName } });
      await tx.membership.create({ data: { userId, workspaceId: workspace.id, role: "OWNER" } });
      if (opts.demo) await seedDemoData(tx, workspace.id);
      return workspace;
    },
    { timeout: 60_000 },
  );
}

export type Member = { userId: string; name: string | null; email: string; image: string | null; role: Role; joinedAt: Date };
export type PendingInvite = { id: string; email: string; role: Role; invitedBy: string; expiresAt: Date };

export async function getWorkspaceSettings(ctx: WorkspaceContext) {
  const [members, invites, demoRows] = await Promise.all([
    db.membership.findMany({
      where: { workspaceId: ctx.workspace.id },
      select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // Pending invites are visible to owners only.
    ctx.role === "OWNER"
      ? db.invite.findMany({
          where: { workspaceId: ctx.workspace.id, acceptedAt: null },
          select: { id: true, email: true, role: true, expiresAt: true, invitedBy: { select: { name: true, email: true } } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    countDemoData(ctx),
  ]);
  return {
    workspace: ctx.workspace,
    role: ctx.role,
    members: members.map<Member>((m) => ({
      userId: m.user.id, name: m.user.name, email: m.user.email, image: m.user.image, role: m.role, joinedAt: m.createdAt,
    })),
    invites: invites.map<PendingInvite>((i) => ({
      id: i.id, email: i.email, role: i.role, invitedBy: i.invitedBy.name ?? i.invitedBy.email, expiresAt: i.expiresAt,
    })),
    demoRows,
  };
}

export async function renameWorkspace(ctx: WorkspaceContext, name: string) {
  requireRole(ctx, "OWNER", "Renaming the workspace");
  await db.workspace.update({ where: { id: ctx.workspace.id }, data: { name: cleanName(name) } });
}

export async function inviteMember(ctx: WorkspaceContext, rawEmail: string, role: Role, now = new Date()) {
  requireRole(ctx, "OWNER", "Inviting members");
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email)) throw new AccessError("Enter a valid email address.");
  const existing = await db.membership.findFirst({ where: { workspaceId: ctx.workspace.id, user: { email } } });
  if (existing) throw new AccessError(`${email} is already a member.`);
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY);
  // Re-inviting refreshes the role and expiry.
  return db.invite.upsert({
    where: { workspaceId_email: { workspaceId: ctx.workspace.id, email } },
    create: { workspaceId: ctx.workspace.id, email, role, invitedById: ctx.user.id, expiresAt },
    update: { role, invitedById: ctx.user.id, expiresAt, acceptedAt: null, createdAt: now },
  });
}

export async function revokeInvite(ctx: WorkspaceContext, inviteId: string) {
  requireRole(ctx, "OWNER", "Revoking invites");
  const { count } = await db.invite.deleteMany({ where: { id: inviteId, workspaceId: ctx.workspace.id, acceptedAt: null } });
  if (count === 0) throw new AccessError("Invite not found.");
}

async function ownerCount(workspaceId: string) {
  return db.membership.count({ where: { workspaceId, role: "OWNER" } });
}

async function membershipIn(ctx: WorkspaceContext, userId: string) {
  const m = await db.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId: ctx.workspace.id } } });
  if (!m) throw new AccessError("That person isn't a member of this workspace.");
  return m;
}

export async function changeRole(ctx: WorkspaceContext, userId: string, role: Role) {
  requireRole(ctx, "OWNER", "Changing roles");
  const m = await membershipIn(ctx, userId);
  if (m.role === "OWNER" && role !== "OWNER" && (await ownerCount(ctx.workspace.id)) <= 1) {
    throw new AccessError("A workspace needs at least one owner. Make someone else an owner first.");
  }
  await db.membership.update({ where: { id: m.id }, data: { role } });
}

export async function removeMember(ctx: WorkspaceContext, userId: string) {
  requireRole(ctx, "OWNER", "Removing members");
  const m = await membershipIn(ctx, userId);
  if (m.role === "OWNER" && (await ownerCount(ctx.workspace.id)) <= 1) {
    throw new AccessError("You can't remove the last owner.");
  }
  await db.membership.delete({ where: { id: m.id } });
}

// Children before parents. A record counts as demo data if it is, or if it hangs off
// a demo record (so user-added rows attached to demo cohorts don't block the delete).
function demoFilters(workspaceId: string) {
  const w = { workspaceId };
  const demo = { isDemo: true };
  return [
    ["activityEvent", { ...w, isDemo: true }],
    ["checklistItem", { ...w, OR: [demo, { launch: demo }] }],
    ["launch", { ...w, OR: [demo, { course: demo }, { cohort: demo }] }],
    ["project", { ...w, OR: [demo, { course: demo }, { cohort: demo }] }],
    ["issue", { ...w, OR: [demo, { course: demo }, { cohort: demo }, { session: demo }] }],
    ["learnerFeedback", { ...w, OR: [demo, { session: demo }, { cohort: demo }] }],
    ["session", { ...w, OR: [demo, { cohort: demo }, { module: demo }, { instructor: demo }, { sme: demo }] }],
    ["moduleVersion", { ...w, OR: [demo, { module: demo }] }],
    ["module", { ...w, OR: [demo, { course: demo }, { reviewer: demo }] }],
    ["cohort", { ...w, OR: [demo, { course: demo }] }],
    ["course", { ...w, isDemo: true }],
    ["sME", { ...w, isDemo: true }],
    ["instructor", { ...w, isDemo: true }],
  ] as const;
}

type DemoModel = ReturnType<typeof demoFilters>[number][0];
type Delegate = { count(a: { where: object }): Promise<number>; deleteMany(a: { where: object }): Promise<{ count: number }> };
const delegate = (client: object, model: DemoModel) => (client as Record<DemoModel, Delegate>)[model];

export async function countDemoData(ctx: WorkspaceContext): Promise<number> {
  const counts = await Promise.all(demoFilters(ctx.workspace.id).map(([m, where]) => delegate(db, m).count({ where })));
  return counts.reduce((a, b) => a + b, 0);
}

/** Delete demo rows (and anything attached to them) from the current workspace only. */
export async function clearDemoData(ctx: WorkspaceContext): Promise<number> {
  requireRole(ctx, "OWNER", "Clearing demo data");
  return db.$transaction(
    async (tx) => {
      let total = 0;
      for (const [m, where] of demoFilters(ctx.workspace.id)) total += (await delegate(tx, m).deleteMany({ where })).count;
      await dropEmptyTrashBatches(tx, ctx.workspace.id);
      return total;
    },
    { timeout: 60_000 },
  );
}

// ---------- Deleting a workspace or an account ----------

const sameText = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Everything in the workspace, children first (required foreign keys are RESTRICT), then the workspace. */
async function hardDeleteWorkspace(tx: Tx, workspaceId: string) {
  await deleteAllDomainRows(tx, workspaceId);
  await tx.workspace.delete({ where: { id: workspaceId } }); // cascades members, invites, imports, AI settings, Trash
}

/**
 * Owners: permanently delete the workspace and all its data. Not recoverable, so the owner
 * types its name. The workspace's own activity log goes with it; the server log keeps a line.
 */
export async function deleteWorkspace(ctx: WorkspaceContext, confirmName: string) {
  requireRole(ctx, "OWNER", "Deleting the workspace");
  if (!sameText(confirmName, ctx.workspace.name)) throw new AccessError(`Type the workspace name (${ctx.workspace.name}) to confirm.`);
  await db.$transaction((tx) => hardDeleteWorkspace(tx, ctx.workspace.id), { timeout: 120_000 });
  console.info(`[delete] ${ctx.user.email} deleted workspace ${ctx.workspace.id} ("${ctx.workspace.name}")`);
}

export type AccountDeletionPlan = {
  /** Workspaces where you're the only owner: deleted with your account. */
  deletes: { id: string; name: string; otherMembers: number }[];
  /** Workspaces you just leave (someone else owns them too, or you aren't an owner). */
  leaves: { id: string; name: string }[];
};

/** What deleting this user's account would do to their workspaces. */
export async function planAccountDeletion(userId: string, client: Pick<Tx, "membership"> = db): Promise<AccountDeletionPlan> {
  const memberships = await client.membership.findMany({
    where: { userId },
    select: { role: true, workspace: { select: { id: true, name: true, memberships: { select: { role: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const plan: AccountDeletionPlan = { deletes: [], leaves: [] };
  for (const m of memberships) {
    const w = m.workspace;
    const owners = w.memberships.filter((x) => x.role === "OWNER").length;
    if (m.role === "OWNER" && owners === 1) plan.deletes.push({ id: w.id, name: w.name, otherMembers: w.memberships.length - 1 });
    else plan.leaves.push({ id: w.id, name: w.name });
  }
  return plan;
}

/**
 * Delete your own account: workspaces where you're the only owner are deleted, you leave
 * the others (logged there), pending invites to your address go, and your Google grant is
 * revoked. You type your email to confirm. Afterwards the session no longer resolves a user.
 */
export async function deleteAccount(userId: string, confirmEmail: string, opts: { fetchImpl?: Fetch; now?: Date } = {}) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AccessError("That account doesn't exist.");
  if (normalizeEmail(confirmEmail) !== normalizeEmail(user.email)) throw new AccessError(`Type your email (${user.email}) to confirm.`);
  const now = opts.now ?? new Date();
  const actor = user.name ?? user.email;
  await revokeGoogleGrant(userId, opts.fetchImpl);
  const plan = await db.$transaction(
    async (tx) => {
      // Planned inside the transaction, so a co-owner leaving meanwhile can't strand a workspace.
      const p = await planAccountDeletion(userId, tx);
      for (const w of p.deletes) await hardDeleteWorkspace(tx, w.id);
      for (const w of p.leaves) {
        await tx.activityEvent.create({
          data: {
            workspaceId: w.id, entityType: "Member", entityId: userId, action: "member_left",
            summary: `${actor} deleted their account and left the workspace`, actorName: actor, createdAt: now,
          },
        });
      }
      await tx.invite.deleteMany({ where: { email: normalizeEmail(user.email) } });
      await tx.user.delete({ where: { id: userId } }); // cascades Google accounts, memberships, invites sent
      return p;
    },
    { timeout: 120_000 },
  );
  console.info(`[delete] ${user.email} deleted their account; workspaces deleted: ${plan.deletes.map((w) => w.id).join(", ") || "none"}`);
  return plan;
}
