// Who may sign in, and which workspace a signed-in user is acting in.
// Database-only (no Next request APIs), so tests call these directly.
import { db } from "@/lib/db";
import { AccessError, hasRole, ROLE_LABELS, type Role } from "@/lib/auth/roles";

export const INVITE_TTL_DAYS = 14;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function adminEmails(env: string | undefined = process.env.ALLOWED_EMAILS): Set<string> {
  return new Set((env ?? "").split(",").map(normalizeEmail).filter(Boolean));
}

/**
 * Invite-only sign-in: admins (ALLOWED_EMAILS), existing members, and anyone with a
 * pending, unexpired invite. Everyone else is turned away before an account is created.
 */
export async function isSignInAllowed(email: string, now = new Date()): Promise<boolean> {
  const e = normalizeEmail(email);
  if (!e) return false;
  if (adminEmails().has(e)) return true;
  const [member, invite] = await Promise.all([
    db.membership.findFirst({ where: { user: { email: e } }, select: { id: true } }),
    db.invite.findFirst({ where: { email: e, acceptedAt: null, expiresAt: { gt: now } }, select: { id: true } }),
  ]);
  return !!member || !!invite;
}

/** Turn the user's pending invites into memberships. Existing memberships keep their role. */
export async function acceptPendingInvites(userId: string, email: string, now = new Date()): Promise<number> {
  const invites = await db.invite.findMany({
    where: { email: normalizeEmail(email), acceptedAt: null, expiresAt: { gt: now } },
  });
  for (const inv of invites) {
    await db.$transaction([
      db.membership.upsert({
        where: { userId_workspaceId: { userId, workspaceId: inv.workspaceId } },
        create: { userId, workspaceId: inv.workspaceId, role: inv.role },
        update: {},
      }),
      db.invite.update({ where: { id: inv.id }, data: { acceptedAt: now } }),
    ]);
  }
  return invites.length;
}

declare const verified: unique symbol;

/**
 * The user, the workspace they're acting in, and their role there. Only contextFor()
 * creates one, after checking membership, so every lib/data function can trust it.
 */
export type WorkspaceContext = {
  user: { id: string; email: string; name: string | null };
  workspace: { id: string; name: string };
  role: Role;
  readonly [verified]: true;
};

export type WorkspaceSummary = { id: string; name: string; role: Role };

export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  const memberships = await db.membership.findMany({
    where: { userId },
    select: { role: true, workspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role }));
}

/** Context for `userId` in `workspaceId`. Throws AccessError unless they're a member. */
export async function contextFor(userId: string, workspaceId: string): Promise<WorkspaceContext> {
  const m = await db.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: {
      role: true,
      user: { select: { id: true, email: true, name: true } },
      workspace: { select: { id: true, name: true } },
    },
  });
  if (!m) throw new AccessError("You are not a member of this workspace.");
  return { user: m.user, workspace: m.workspace, role: m.role } as WorkspaceContext;
}

export function requireRole(ctx: WorkspaceContext, atLeast: Role, action: string): void {
  if (!hasRole(ctx.role, atLeast)) {
    throw new AccessError(`${action} needs the ${ROLE_LABELS[atLeast]} role (yours: ${ROLE_LABELS[ctx.role]}).`);
  }
}
