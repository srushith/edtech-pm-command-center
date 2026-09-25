// Roles and permission checks. Pure, so client components can use the labels too.
import type { Role } from "@/lib/generated/prisma/enums";

export type { Role };
export const ROLES: Role[] = ["OWNER", "EDITOR", "VIEWER"];

export const ROLE_LABELS: Record<Role, string> = { OWNER: "Owner", EDITOR: "Editor", VIEWER: "Viewer" };
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Edit records, manage members and settings",
  EDITOR: "Edit records",
  VIEWER: "Read only",
};

const RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };
export const hasRole = (role: Role, atLeast: Role) => RANK[role] >= RANK[atLeast];

/** Thrown when the current user may not read or change something. Messages are safe to show. */
export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessError";
  }
}

export function parseRole(value: unknown): Role | null {
  return typeof value === "string" && (ROLES as string[]).includes(value) ? (value as Role) : null;
}
