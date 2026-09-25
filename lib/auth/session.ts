// Request-time auth for server components and actions: who is signed in, and which
// of their workspaces they're acting in. Redirects instead of rendering when either is missing.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { acceptPendingInvites, contextFor, listWorkspaces, type WorkspaceContext } from "@/lib/auth/access";
import { db } from "@/lib/db";

export const WORKSPACE_COOKIE = "cc-workspace";

/** The signed-in user (with pending invites accepted), or a redirect to /signin. */
export const requireUser = cache(async () => {
  const session = await auth();
  const id = session?.user?.id;
  const user = id ? await db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, image: true } }) : null;
  if (!user) redirect("/signin");
  await acceptPendingInvites(user.id, user.email);
  return user;
});

/**
 * The current workspace context. Uses the cc-workspace cookie when it names one of the
 * user's workspaces, else their first. No workspaces yet: onboarding.
 */
export const requireWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);
  if (workspaces.length === 0) redirect("/onboarding");
  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const current = workspaces.find((w) => w.id === preferred) ?? workspaces[0];
  return contextFor(user.id, current.id);
});
