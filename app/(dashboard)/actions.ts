"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { contextFor } from "@/lib/auth/access";
import { requireUser, requireWorkspace, WORKSPACE_COOKIE } from "@/lib/auth/session";
import { getSearchIndex } from "@/lib/data/search";
import type { SearchItem } from "@/lib/search-types";

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function searchIndex(): Promise<SearchItem[]> {
  return getSearchIndex(await requireWorkspace());
}

/** Switch to another of the user's workspaces. Filters are dropped: their codes belong to the old one. */
export async function switchWorkspace(workspaceId: string): Promise<void> {
  const user = await requireUser();
  await contextFor(user.id, workspaceId); // throws unless a member
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: ONE_YEAR, secure: process.env.NODE_ENV === "production",
  });
  redirect("/");
}

/** Back to the login page. The workspace cookie goes too, so the next person starts fresh. */
export async function signOutAction(): Promise<void> {
  (await cookies()).delete(WORKSPACE_COOKIE);
  await signOut({ redirectTo: "/signin" });
}
