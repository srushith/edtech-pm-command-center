// Shared setup for tests that hit the test database. Run through `npm test`, which
// points DATABASE_URL at DATABASE_URL_TEST and sets CC_TEST_DB.
import { db } from "@/lib/db";
import { contextFor, type WorkspaceContext } from "@/lib/auth/access";
import type { Role } from "@/lib/auth/roles";
import { createWorkspace } from "@/lib/data/workspaces";

// Tests don't depend on the developer's .env.local secrets.
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.AUTH_SECRET ||= "test-auth-secret";

if (process.env.CC_TEST_DB !== "1") {
  throw new Error("Run tests with `npm test`: it targets DATABASE_URL_TEST, and these tests wipe their database.");
}

/** Empty every table in the test database. */
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  }
}

export async function makeUser(email: string, name = email.split("@")[0]) {
  return db.user.create({ data: { email, name } });
}

/** A workspace owned by `ownerId`, with members added directly at the given roles. */
export async function makeWorkspace(ownerId: string, name: string, opts: { demo?: boolean; members?: [string, Role][] } = {}) {
  const ws = await createWorkspace(ownerId, name, { demo: opts.demo ?? false });
  for (const [userId, role] of opts.members ?? []) {
    await db.membership.create({ data: { userId, workspaceId: ws.id, role } });
  }
  return ws;
}

export const ctx = (userId: string, workspaceId: string): Promise<WorkspaceContext> => contextFor(userId, workspaceId);
