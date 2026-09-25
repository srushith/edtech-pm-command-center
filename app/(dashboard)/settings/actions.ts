"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { WorkspaceContext } from "@/lib/auth/access";
import { AccessError, parseRole, ROLE_LABELS } from "@/lib/auth/roles";
import { requireWorkspace } from "@/lib/auth/session";
import {
  changeRole,
  clearDemoData,
  inviteMember,
  removeMember,
  renameWorkspace,
  revokeInvite,
} from "@/lib/data/workspaces";

export type ActionResult = { error?: string; message?: string };

// Every action re-resolves the workspace context; lib/data enforces the role.
async function run(fn: (ctx: WorkspaceContext) => Promise<string | void>): Promise<ActionResult> {
  const ctx = await requireWorkspace();
  try {
    const message = await fn(ctx);
    revalidatePath("/", "layout"); // the switcher shows the workspace name
    return message ? { message } : {};
  } catch (e) {
    if (e instanceof AccessError) return { error: e.message };
    throw e;
  }
}

export async function renameAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async (ctx) => {
    await renameWorkspace(ctx, String(form.get("name") ?? ""));
    return "Workspace renamed.";
  });
}

export async function inviteAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const role = parseRole(form.get("role"));
  if (!role) return { error: "Choose a role." };
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  return run(async (ctx) => {
    const invite = await inviteMember(ctx, String(form.get("email") ?? ""), role);
    return `Invited ${invite.email} as ${ROLE_LABELS[invite.role]}. No email is sent: ask them to sign in with Google at ${origin}.`;
  });
}

export async function revokeInviteAction(inviteId: string): Promise<ActionResult> {
  return run(async (ctx) => {
    await revokeInvite(ctx, inviteId);
    return "Invite revoked.";
  });
}

export async function changeRoleAction(userId: string, rawRole: string): Promise<ActionResult> {
  const role = parseRole(rawRole);
  if (!role) return { error: "Unknown role." };
  return run(async (ctx) => {
    await changeRole(ctx, userId, role);
    return "Role updated.";
  });
}

export async function removeMemberAction(userId: string): Promise<ActionResult> {
  let leftWorkspace = false;
  const result = await run(async (ctx) => {
    await removeMember(ctx, userId);
    leftWorkspace = userId === ctx.user.id;
    return "Member removed.";
  });
  // Removing yourself: land in your next workspace (or onboarding).
  if (leftWorkspace) redirect("/");
  return result;
}

export async function clearDemoDataAction(): Promise<ActionResult> {
  return run(async (ctx) => {
    const n = await clearDemoData(ctx);
    return `Deleted ${n.toLocaleString()} demo records.`;
  });
}
