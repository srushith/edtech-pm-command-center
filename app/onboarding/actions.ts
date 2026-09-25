"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccessError } from "@/lib/auth/roles";
import { requireUser, WORKSPACE_COOKIE } from "@/lib/auth/session";
import { createWorkspace } from "@/lib/data/workspaces";

export type OnboardingState = { error?: string };

export async function createWorkspaceAction(_: OnboardingState, form: FormData): Promise<OnboardingState> {
  const user = await requireUser();
  let workspaceId: string;
  try {
    const ws = await createWorkspace(user.id, String(form.get("name") ?? ""), { demo: form.get("start") === "demo" });
    workspaceId = ws.id;
  } catch (e) {
    if (e instanceof AccessError) return { error: e.message };
    throw e;
  }
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === "production",
  });
  redirect("/");
}
