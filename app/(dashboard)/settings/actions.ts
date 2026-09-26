"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { WorkspaceContext } from "@/lib/auth/access";
import { AccessError, parseRole, ROLE_LABELS } from "@/lib/auth/roles";
import { signOut } from "@/lib/auth";
import { requireUser, requireWorkspace, WORKSPACE_COOKIE } from "@/lib/auth/session";
import { deleteForever, emptyTrash, restoreFromTrash } from "@/lib/data/trash";
import { removeAIKey, saveAISettings, testAIKey } from "@/lib/data/ai-settings";
import {
  changeRole,
  clearDemoData,
  deleteAccount,
  deleteWorkspace,
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

// ---------- AI (owners only; enforced in lib/data/ai-settings) ----------

export async function saveAISettingsAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async (ctx) => {
    await saveAISettings(ctx, {
      provider: String(form.get("provider") ?? ""),
      model: String(form.get("model") ?? ""),
      apiKey: String(form.get("apiKey") ?? ""),
      monthlyRequestLimit: String(form.get("monthlyRequestLimit") ?? ""),
    });
    return "AI settings saved.";
  });
}

/** Tests the typed key, or the saved one when the key field is blank. Never returns the key. */
export async function testAIKeyAction(input: { provider: string; model: string; apiKey: string }): Promise<ActionResult> {
  const ctx = await requireWorkspace();
  try {
    const r = await testAIKey(ctx, input);
    revalidatePath("/settings");
    return r.ok ? { message: r.message } : { error: r.message };
  } catch (e) {
    if (e instanceof AccessError) return { error: e.message };
    throw e;
  }
}

export async function removeAIKeyAction(): Promise<ActionResult> {
  return run(async (ctx) => {
    await removeAIKey(ctx);
    return "AI key removed. This workspace now uses the mock.";
  });
}

// ---------- Trash (owners only; enforced in lib/data/trash) ----------

export async function restoreFromTrashAction(batchId: string): Promise<ActionResult> {
  return run(async (ctx) => `Restored ${(await restoreFromTrash(ctx, String(batchId))).label}.`);
}

export async function deleteForeverAction(batchId: string): Promise<ActionResult> {
  return run(async (ctx) => `Permanently deleted ${(await deleteForever(ctx, String(batchId))).label}.`);
}

export async function emptyTrashAction(): Promise<ActionResult> {
  return run(async (ctx) => {
    const r = await emptyTrash(ctx);
    return r.items ? `Trash emptied: ${r.removed.toLocaleString()} records permanently deleted.` : "Trash is already empty.";
  });
}

// ---------- Deleting the workspace or your account ----------

/** Owners. Lands in your next workspace, or onboarding when there's none. */
export async function deleteWorkspaceAction(confirmName: string): Promise<ActionResult> {
  const ctx = await requireWorkspace();
  try {
    await deleteWorkspace(ctx, String(confirmName ?? ""));
  } catch (e) {
    if (e instanceof AccessError) return { error: e.message };
    throw e;
  }
  (await cookies()).delete(WORKSPACE_COOKIE);
  revalidatePath("/", "layout");
  redirect("/");
}

/** Your own account only (the id comes from the session). Signs out to the login page. */
export async function deleteAccountAction(confirmEmail: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await deleteAccount(user.id, String(confirmEmail ?? ""));
  } catch (e) {
    if (e instanceof AccessError) return { error: e.message };
    throw e;
  }
  (await cookies()).delete(WORKSPACE_COOKIE);
  await signOut({ redirectTo: "/signin" });
  return {};
}
