// The only way lib/data reads or writes domain records.
//
// scopedDb(ctx) wraps Prisma so that, for every tenant model:
//   - reads, updates and deletes are filtered to ctx.workspace (an id from another
//     workspace simply isn't found);
//   - creates are stamped with ctx.workspace, overriding any workspaceId passed in;
//   - writes need the editor role or above;
//   - rows in Trash (deletedAt set) are hidden from reads and writes, unless the query's
//     top-level `where` names deletedAt itself (spread `withTrash` or `onlyTrash`).
//     Only lib/data/trash.ts and the uniqueness/numbering checks in lib/data/records.ts do.
// Accounts, memberships and invites aren't reachable here (see lib/data/workspaces.ts),
// nor is raw SQL. Use flat (unchecked) create/update inputs: nested writes are not scoped.
// Prisma's types still require workspaceId on create: pass ctx.workspace.id (it's overwritten anyway).
import { db } from "@/lib/db";
import { AccessError, hasRole } from "@/lib/auth/roles";
import type { WorkspaceContext } from "@/lib/auth/access";

export const TENANT_MODELS = new Set([
  "Course", "Cohort", "Instructor", "SME", "Module", "ModuleVersion", "Session",
  "LearnerFeedback", "Issue", "Project", "Launch", "ChecklistItem", "ActivityEvent",
  "ImportSource", "ImportRun", "ImportLink", "TrashBatch",
]);

/** Models with soft delete (deletedAt / trashBatchId). */
export const SOFT_DELETE_MODELS = new Set([
  "Course", "Cohort", "Instructor", "SME", "Module", "ModuleVersion", "Session",
  "LearnerFeedback", "Issue", "Project", "Launch", "ChecklistItem",
]);

/** Spread into a `where` to include rows in Trash. */
export const withTrash = { deletedAt: undefined };
/** Spread into a `where` to match only rows in Trash. */
export const onlyTrash = { deletedAt: { not: null } };

const READS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
]);
const FILTERED_WRITES = new Set(["update", "updateMany", "updateManyAndReturn", "delete", "deleteMany"]);
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);

type Args = { where?: object; data?: object | object[]; create?: object; update?: object };

function rawBlocked(..._args: unknown[]): never {
  throw new AccessError("Raw SQL is not available on the workspace-scoped client.");
}

export function scopedDb(ctx: WorkspaceContext) {
  const workspaceId = ctx.workspace.id;
  const canWrite = hasRole(ctx.role, "EDITOR");

  return db.$extends({
    name: "workspace-scope",
    client: {
      $queryRaw: rawBlocked,
      $executeRaw: rawBlocked,
      $queryRawUnsafe: rawBlocked,
      $executeRawUnsafe: rawBlocked,
    },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            throw new AccessError(`${model} is not accessible through the workspace-scoped client.`);
          }
          const a = (args ?? {}) as Args;
          const live = SOFT_DELETE_MODELS.has(model) && !(a.where && "deletedAt" in a.where) ? { deletedAt: null } : {};
          if (READS.has(operation)) {
            return query({ ...a, where: { ...live, ...a.where, workspaceId } });
          }
          if (!canWrite) throw new AccessError("Viewers can read but not change records.");
          if (FILTERED_WRITES.has(operation)) {
            return query({ ...a, where: { ...live, ...a.where, workspaceId } });
          }
          if (CREATES.has(operation)) {
            const data = Array.isArray(a.data)
              ? a.data.map((d) => ({ ...d, workspaceId }))
              : { ...a.data, workspaceId };
            return query({ ...a, data });
          }
          if (operation === "upsert") {
            return query({
              ...a,
              where: { ...live, ...a.where, workspaceId },
              create: { ...a.create, workspaceId },
              update: { ...a.update, workspaceId },
            } as typeof args);
          }
          throw new AccessError(`Operation ${operation} is not supported on the workspace-scoped client.`);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedDb>;
