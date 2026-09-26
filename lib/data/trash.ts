// Trash: soft delete with cascade, undo, restore and permanent deletion.
//
// Deleting moves records, and everything that can't exist without them (a course's cohorts,
// their sessions, those sessions' feedback, ...), to Trash as one TrashBatch. Optional links
// to them (an issue's cohort, a module's SME reviewer, ...) are cleared and remembered in the
// batch, so a restore puts them back. scopedDb hides trashed rows from every read and write.
// Invariant: a live row never has a trashed required parent. Deletes take the whole subtree,
// restores wait for trashed parents, and instructors with sessions can't be deleted at all.
//
// Roles: editors and owners move records to Trash, and whoever deleted can undo for 2 minutes;
// only owners list, restore, purge or empty the Trash. Batches older than 30 days are purged
// lazily (there's no cron): on deletes, saves, imports and when an owner opens the Trash.
// Trash uses the wall clock, also for demo rows: deleting is something a person does now.
import { requireRole, type WorkspaceContext } from "@/lib/auth/access";
import { AccessError, hasRole } from "@/lib/auth/roles";
import { onlyTrash, scopedDb } from "@/lib/data/scoped";
import { RECORD_HANDLERS, recomputeRatings, type RecordRow, type RecordTx } from "@/lib/data/records";
import { RECORDS } from "@/lib/records/registry";
import type { EntityType } from "@/lib/search-types";

export const TRASH_DAYS = 30;
export const UNDO_WINDOW_MS = 2 * 60_000;
export const MAX_DELETE = 200;
const DAY_MS = 86_400_000;

type M =
  | "course" | "cohort" | "instructor" | "sME" | "module" | "moduleVersion" | "session"
  | "learnerFeedback" | "issue" | "project" | "launch" | "checklistItem";
type Link = { model: M; field: string };
type Row = RecordRow;
type Delegate = {
  findMany(a: object): Promise<Row[]>;
  findFirst(a: object): Promise<Row | null>;
  count(a: object): Promise<number>;
  updateMany(a: object): Promise<{ count: number }>;
  deleteMany(a: object): Promise<{ count: number }>;
};
const model = (client: object, m: M) => (client as Record<M, Delegate>)[m];

// Children that can't exist without their parent: they go to Trash with it.
const REQUIRED_CHILDREN: Record<M, Link[]> = {
  course: [
    { model: "cohort", field: "courseId" }, { model: "module", field: "courseId" },
    { model: "launch", field: "courseId" }, { model: "project", field: "courseId" },
  ],
  cohort: [{ model: "session", field: "cohortId" }, { model: "learnerFeedback", field: "cohortId" }, { model: "project", field: "cohortId" }],
  session: [{ model: "learnerFeedback", field: "sessionId" }],
  module: [{ model: "moduleVersion", field: "moduleId" }],
  launch: [{ model: "checklistItem", field: "launchId" }],
  // Sessions require their instructor too, but an instructor with sessions can't be deleted
  // (their history would go with them): mark them inactive instead. See BLOCKERS.
  instructor: [], sME: [], moduleVersion: [], learnerFeedback: [], issue: [], project: [], checklistItem: [],
};
const BLOCKERS: Partial<Record<M, Link>> = { instructor: { model: "session", field: "instructorId" } };

/** Every required parent link, for restore checks and purges. */
const REQUIRED_PARENTS: Partial<Record<M, { parent: M; field: string }[]>> = {};
for (const [parent, links] of Object.entries({ ...REQUIRED_CHILDREN, instructor: [BLOCKERS.instructor!] }) as [M, Link[]][]) {
  for (const l of links) (REQUIRED_PARENTS[l.model] ??= []).push({ parent, field: l.field });
}

// Optional links: cleared while their target is in Trash.
const OPTIONAL_LINKS: Partial<Record<M, Link[]>> = {
  course: [{ model: "issue", field: "courseId" }],
  cohort: [{ model: "issue", field: "cohortId" }, { model: "launch", field: "cohortId" }],
  session: [{ model: "issue", field: "sessionId" }],
  module: [{ model: "session", field: "moduleId" }],
  sME: [{ model: "module", field: "reviewerId" }, { model: "session", field: "smeId" }],
};

// Permanent deletion goes children first: several required foreign keys are RESTRICT.
const PURGE_ORDER: M[] = [
  "checklistItem", "learnerFeedback", "moduleVersion", "project", "issue", "launch",
  "session", "module", "cohort", "course", "sME", "instructor",
];

const PLURAL: Record<M, string> = {
  course: "courses", cohort: "cohorts", instructor: "instructors", sME: "SMEs", module: "modules",
  moduleVersion: "module versions", session: "sessions", learnerFeedback: "feedback entries", issue: "issues",
  project: "projects", launch: "launches", checklistItem: "checklist items",
};
const SINGULAR: Record<M, string> = {
  course: "course", cohort: "cohort", instructor: "instructor", sME: "SME", module: "module",
  moduleVersion: "module version", session: "session", learnerFeedback: "feedback entry", issue: "issue",
  project: "project", launch: "launch", checklistItem: "checklist item",
};
const LINK_LABEL: Record<string, string> = {
  courseId: "course", cohortId: "cohort", sessionId: "session", moduleId: "module", reviewerId: "SME reviewer", smeId: "guest SME",
};
const ENTITY_OF: Partial<Record<M, EntityType>> = Object.fromEntries(
  (Object.keys(RECORD_HANDLERS) as EntityType[]).map((t) => [RECORD_HANDLERS[t].model, t]),
);

const count = (n: number, m: M) => `${n} ${n === 1 ? SINGULAR[m] : PLURAL[m]}`;
const list = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const actorOf = (ctx: WorkspaceContext) => ctx.user.name ?? ctx.user.email;
const modelOf = (type: EntityType) => RECORD_HANDLERS[type].model as M;
const displayOf = (m: M, row: Row) => {
  const t = ENTITY_OF[m];
  return t ? RECORD_HANDLERS[t].display(row) : String(row.label ?? row.version ?? row.id);
};

/** What you type to confirm deleting a record with dependents: the name you know it by. */
function confirmNameOf(type: EntityType, row: Row): string {
  if (type === "course") return String(row.name);
  if (type === "cohort" || type === "issue") return String(row.code);
  return RECORD_HANDLERS[type].display(row);
}

export type Unlink = { model: M; field: string; target: M; value: string; ids: string[] };
export type ContentsLine = { label: string; count: number };

type Plan = {
  type: EntityType;
  roots: Row[];
  rows: Map<M, Row[]>;
  unlinks: Unlink[];
  blocked: { id: string; label: string; reason: string }[];
};

/** The records a delete takes with it, the links it clears, and what blocks it. Reads live rows only. */
async function planDelete(db: object, type: EntityType, ids: string[]): Promise<Plan> {
  const rootModel = modelOf(type);
  const roots = await model(db, rootModel).findMany({ where: { id: { in: ids } } });
  if (roots.length !== ids.length) {
    throw new AccessError(ids.length === 1 ? "That record doesn't exist in this workspace (or is already in Trash)." : "Some of these records don't exist in this workspace (or are already in Trash). Refresh and try again.");
  }

  const rows = new Map<M, Row[]>([[rootModel, roots]]);
  const seen = new Set(roots.map((r) => r.id));
  const queue: [M, string[]][] = [[rootModel, ids]];
  while (queue.length) {
    const [m, parentIds] = queue.shift()!;
    for (const link of REQUIRED_CHILDREN[m]) {
      const fresh = (await model(db, link.model).findMany({ where: { [link.field]: { in: parentIds } } })).filter((r) => !seen.has(r.id));
      if (!fresh.length) continue;
      for (const r of fresh) seen.add(r.id);
      rows.set(link.model, [...(rows.get(link.model) ?? []), ...fresh]);
      queue.push([link.model, fresh.map((r) => r.id)]);
    }
  }

  const unlinks: Unlink[] = [];
  const blocked: Plan["blocked"] = [];
  for (const [m, targets] of rows) {
    const targetIds = targets.map((r) => r.id);
    for (const link of OPTIONAL_LINKS[m] ?? []) {
      const linked = (await model(db, link.model).findMany({ where: { [link.field]: { in: targetIds } }, select: { id: true, [link.field]: true } }))
        .filter((r) => !seen.has(r.id));
      const byValue = new Map<string, string[]>();
      for (const r of linked) byValue.set(String(r[link.field]), [...(byValue.get(String(r[link.field])) ?? []), r.id]);
      for (const [value, rowIds] of byValue) unlinks.push({ model: link.model, field: link.field, target: m, value, ids: rowIds });
    }
    const blocker = BLOCKERS[m];
    if (blocker) {
      const deps = (await model(db, blocker.model).findMany({ where: { [blocker.field]: { in: targetIds } }, select: { id: true, [blocker.field]: true } }))
        .filter((r) => !seen.has(r.id));
      for (const t of targets) {
        const n = deps.filter((d) => d[blocker.field] === t.id).length;
        if (n) blocked.push({ id: t.id, label: displayOf(m, t), reason: `teaches ${count(n, blocker.model)}` });
      }
    }
  }
  return { type, roots, rows, unlinks, blocked };
}

function contentsOf(p: Plan): ContentsLine[] {
  const rootModel = modelOf(p.type);
  const out: ContentsLine[] = [];
  for (const m of [...PURGE_ORDER].reverse()) {
    const n = (p.rows.get(m)?.length ?? 0) - (m === rootModel ? p.roots.length : 0);
    if (n > 0) out.push({ label: n === 1 ? SINGULAR[m] : PLURAL[m], count: n });
  }
  return out;
}

function unlinkLines(unlinks: Unlink[]): ContentsLine[] {
  const byKey = new Map<string, { m: M; field: string; ids: Set<string> }>();
  for (const u of unlinks) {
    const k = `${u.model}.${u.field}`;
    const e = byKey.get(k) ?? { m: u.model, field: u.field, ids: new Set<string>() };
    for (const id of u.ids) e.ids.add(id);
    byKey.set(k, e);
  }
  return [...byKey.values()].map((e) => ({ label: `${e.ids.size === 1 ? SINGULAR[e.m] : PLURAL[e.m]} lose their ${LINK_LABEL[e.field] ?? e.field} link`, count: e.ids.size }));
}

function confirmTextOf(p: Plan): string | null {
  if (!contentsOf(p).length) return null;
  return p.roots.length === 1 ? confirmNameOf(p.type, p.roots[0]) : String(p.roots.length);
}

export type DeletePreview = {
  type: EntityType;
  ids: string[];
  labels: string[];
  /** Everything else that goes to Trash with these records. */
  removes: ContentsLine[];
  /** Records that stay but lose a link (back on restore). */
  unlinks: ContentsLine[];
  /** Records that can't be deleted, and why (instructors with sessions). */
  blocked: { id: string; label: string; reason: string }[];
  /** What to type to confirm (the record's name, or the count for a bulk delete), when others go too. */
  confirmText: string | null;
};

function cleanIds(ids: string[]): string[] {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id))];
  if (!unique.length) throw new AccessError("Choose at least one record.");
  if (unique.length > MAX_DELETE) throw new AccessError(`You can delete up to ${MAX_DELETE} records at a time.`);
  return unique;
}

/** What deleting these records would do. Writes nothing. */
export async function previewDelete(ctx: WorkspaceContext, type: EntityType, ids: string[]): Promise<DeletePreview> {
  requireRole(ctx, "EDITOR", "Deleting records");
  const p = await planDelete(scopedDb(ctx), type, cleanIds(ids));
  return {
    type, ids: p.roots.map((r) => r.id), labels: p.roots.map((r) => RECORD_HANDLERS[type].display(r)),
    removes: contentsOf(p), unlinks: unlinkLines(p.unlinks), blocked: p.blocked, confirmText: confirmTextOf(p),
  };
}

export type DeleteResult = { batchId: string; label: string; count: number };

/**
 * Move records and their dependents to Trash in one transaction, clear optional links to
 * them, recompute ratings, and log a "deleted" ActivityEvent. `confirm` must match the
 * preview's confirmText when there is one.
 */
export async function deleteRecords(
  ctx: WorkspaceContext,
  type: EntityType,
  ids: string[],
  confirm: string | null = null,
  now = new Date(),
): Promise<DeleteResult> {
  requireRole(ctx, "EDITOR", "Deleting records");
  const unique = cleanIds(ids);
  await purgeExpiredTrash(ctx, now);
  const actor = actorOf(ctx);
  const h = RECORD_HANDLERS[type];

  return scopedDb(ctx).$transaction(
    async (tx) => {
      const p = await planDelete(tx, type, unique);
      if (p.blocked.length) {
        const b = p.blocked[0];
        throw new AccessError(`${b.label} ${b.reason}, so they can't be deleted. Mark them inactive instead: their history stays and they leave the pickers.`);
      }
      const expected = confirmTextOf(p);
      if (expected && norm(confirm ?? "") !== norm(expected)) {
        throw new AccessError(`Other records go to Trash too. Type ${p.roots.length === 1 ? "the name" : "the number of records"} (${expected}) to confirm.`);
      }

      const noun = RECORDS[type].noun;
      const label = p.roots.length === 1 ? `${noun} ${h.display(p.roots[0])}` : count(p.roots.length, modelOf(type));
      const contents = contentsOf(p);
      const batch = await tx.trashBatch.create({
        data: {
          workspaceId: ctx.workspace.id, entityType: type, label, rootIds: p.roots.map((r) => r.id),
          contents, unlinks: p.unlinks, deletedById: ctx.user.id, deletedByName: actor, deletedAt: now,
        },
      });
      for (const [m, rows] of p.rows) {
        await model(tx, m).updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deletedAt: now, trashBatchId: batch.id } });
      }
      for (const u of p.unlinks) await model(tx, u.model).updateMany({ where: { id: { in: u.ids } }, data: { [u.field]: null } });

      // Ratings: sessions that lost feedback, and instructors whose sessions left.
      const goneSessions = new Set((p.rows.get("session") ?? []).map((s) => s.id));
      const sessionIds = (p.rows.get("learnerFeedback") ?? []).map((f) => String(f.sessionId)).filter((id) => !goneSessions.has(id));
      const instructorIds = (p.rows.get("session") ?? []).map((s) => String(s.instructorId));
      await recomputeRatings(tx as RecordTx, sessionIds, instructorIds, { clearEmpty: true });

      const withText = contents.length ? ` with ${list(contents.map((c) => `${c.count} ${c.label}`))}` : "";
      await tx.activityEvent.create({
        data: {
          workspaceId: ctx.workspace.id, entityType: h.activityType, entityId: p.roots.length === 1 ? p.roots[0].id : batch.id,
          action: "deleted", summary: `${actor} moved ${label} to Trash${withText}`, actorName: actor, createdAt: now,
        },
      });
      return { batchId: batch.id, label, count: [...p.rows.values()].reduce((n, r) => n + r.length, 0) };
    },
    { timeout: 60_000 },
  );
}

// ---------- Restore ----------

type Batch = { id: string; entityType: string; label: string; unlinks: unknown; deletedById: string | null; deletedAt: Date };

async function restoreBatch(tx: object, ctx: WorkspaceContext, batch: Batch, now: Date, how: "restored" | "undid") {
  const t = tx as RecordTx;
  const rows = new Map<M, Row[]>();
  for (const m of PURGE_ORDER) {
    const found = await model(tx, m).findMany({ where: { trashBatchId: batch.id, ...onlyTrash } });
    if (found.length) rows.set(m, found);
  }
  if (!rows.size) {
    await t.trashBatch.deleteMany({ where: { id: batch.id } });
    throw new AccessError("Nothing is left to restore: those records were permanently deleted.");
  }

  // Required parents must be live, or coming back in this same batch.
  const inBatch = (m: M, id: string) => rows.get(m)?.some((r) => r.id === id) ?? false;
  for (const [m, found] of rows) {
    for (const { parent, field } of REQUIRED_PARENTS[m] ?? []) {
      const parentIds = [...new Set(found.map((r) => String(r[field])))].filter((id) => !inBatch(parent, id));
      if (!parentIds.length) continue;
      const trashed = await model(tx, parent).findFirst({ where: { id: { in: parentIds }, ...onlyTrash } });
      if (trashed) {
        throw new AccessError(`Restore ${SINGULAR[parent]} ${displayOf(parent, trashed)} first: it's in Trash too, and this item belongs to it.`);
      }
    }
  }

  for (const [m, found] of rows) {
    await model(tx, m).updateMany({ where: { id: { in: found.map((r) => r.id) }, ...onlyTrash }, data: { deletedAt: null, trashBatchId: null } });
  }
  // Put cleared links back where the target is live again and nobody re-linked the row since.
  for (const u of (batch.unlinks as Unlink[]) ?? []) {
    if (!(await model(tx, u.target).findFirst({ where: { id: u.value } }))) continue;
    await model(tx, u.model).updateMany({ where: { id: { in: u.ids }, [u.field]: null }, data: { [u.field]: u.value } });
  }
  const sessionIds = (rows.get("learnerFeedback") ?? []).map((f) => String(f.sessionId));
  const instructorIds = (rows.get("session") ?? []).map((s) => String(s.instructorId));
  await recomputeRatings(t, sessionIds, instructorIds);

  await t.trashBatch.deleteMany({ where: { id: batch.id } });
  const actor = actorOf(ctx);
  const type = batch.entityType as EntityType;
  await t.activityEvent.create({
    data: {
      workspaceId: ctx.workspace.id, entityType: RECORD_HANDLERS[type]?.activityType ?? "Trash", entityId: batch.id,
      action: "restored", summary: `${actor} ${how === "undid" ? "undid deleting" : "restored"} ${batch.label}${how === "undid" ? "" : " from Trash"}`,
      actorName: actor, createdAt: now,
    },
  });
  return { label: batch.label };
}

/**
 * Undo right after deleting: the person who deleted can undo for 2 minutes. Owners can
 * always restore (this is the same restore they get from the Trash page).
 */
export async function undoDelete(ctx: WorkspaceContext, batchId: string, now = new Date()) {
  requireRole(ctx, "EDITOR", "Undoing a delete");
  const db = scopedDb(ctx);
  const batch = await db.trashBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new AccessError("That delete can't be undone: it isn't in Trash any more.");
  const own = batch.deletedById === ctx.user.id && now.getTime() - batch.deletedAt.getTime() <= UNDO_WINDOW_MS;
  if (!own && ctx.role !== "OWNER") {
    throw new AccessError("Undo works for 2 minutes after your own delete. After that, ask an owner to restore it from Trash.");
  }
  return db.$transaction((tx) => restoreBatch(tx, ctx, batch, now, "undid"), { timeout: 60_000 });
}

/** Owners: bring a batch back from Trash. */
export async function restoreFromTrash(ctx: WorkspaceContext, batchId: string, now = new Date()) {
  requireRole(ctx, "OWNER", "Restoring from Trash");
  const db = scopedDb(ctx);
  const batch = await db.trashBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new AccessError("That item isn't in Trash.");
  return db.$transaction((tx) => restoreBatch(tx, ctx, batch, now, "restored"), { timeout: 60_000 });
}

// ---------- Permanent deletion ----------

/**
 * Hard-delete the batches' rows, and any trashed rows under them from other batches
 * (they could never be restored without their parent). Batches left empty are dropped.
 */
async function purgeBatches(tx: object, batchIds: string[]): Promise<number> {
  const ids = new Map<M, Set<string>>();
  const touched = new Set(batchIds);
  const add = (m: M, rows: Row[]) => {
    const set = ids.get(m) ?? new Set<string>();
    const fresh = rows.filter((r) => !set.has(r.id));
    for (const r of fresh) {
      set.add(r.id);
      if (r.trashBatchId) touched.add(String(r.trashBatchId));
    }
    ids.set(m, set);
    return fresh.map((r) => r.id);
  };
  const queue: [M, string[]][] = [];
  for (const m of PURGE_ORDER) {
    const rows = await model(tx, m).findMany({ where: { trashBatchId: { in: batchIds }, ...onlyTrash }, select: { id: true, trashBatchId: true } });
    const fresh = add(m, rows);
    if (fresh.length) queue.push([m, fresh]);
  }
  while (queue.length) {
    const [m, parentIds] = queue.shift()!;
    const links = [...REQUIRED_CHILDREN[m], ...(BLOCKERS[m] ? [BLOCKERS[m]!] : [])];
    for (const link of links) {
      const rows = await model(tx, link.model).findMany({ where: { [link.field]: { in: parentIds }, ...onlyTrash }, select: { id: true, trashBatchId: true } });
      const fresh = add(link.model, rows);
      if (fresh.length) queue.push([link.model, fresh]);
    }
  }
  let removed = 0;
  for (const m of PURGE_ORDER) {
    const set = ids.get(m);
    if (set?.size) removed += (await model(tx, m).deleteMany({ where: { id: { in: [...set] }, ...onlyTrash } })).count;
  }
  const t = tx as RecordTx;
  for (const id of touched) {
    let left = 0;
    for (const m of PURGE_ORDER) left += await model(tx, m).count({ where: { trashBatchId: id, ...onlyTrash } });
    if (!left) await t.trashBatch.deleteMany({ where: { id } });
  }
  return removed;
}

/** Owners: permanently delete one item from Trash. */
export async function deleteForever(ctx: WorkspaceContext, batchId: string, now = new Date()) {
  requireRole(ctx, "OWNER", "Deleting from Trash");
  const db = scopedDb(ctx);
  const batch = await db.trashBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new AccessError("That item isn't in Trash.");
  const actor = actorOf(ctx);
  return db.$transaction(async (tx) => {
    const removed = await purgeBatches(tx, [batch.id]);
    await tx.activityEvent.create({
      data: {
        workspaceId: ctx.workspace.id, entityType: RECORD_HANDLERS[batch.entityType as EntityType]?.activityType ?? "Trash", entityId: batch.id,
        action: "purged", summary: `${actor} permanently deleted ${batch.label} from Trash`, actorName: actor, createdAt: now,
      },
    });
    return { label: batch.label, removed };
  }, { timeout: 60_000 });
}

/** Owners: permanently delete everything in Trash. */
export async function emptyTrash(ctx: WorkspaceContext, now = new Date()) {
  requireRole(ctx, "OWNER", "Emptying the Trash");
  const db = scopedDb(ctx);
  const batches = await db.trashBatch.findMany({ select: { id: true } });
  if (!batches.length) return { items: 0, removed: 0 };
  const actor = actorOf(ctx);
  return db.$transaction(async (tx) => {
    const removed = await purgeBatches(tx, batches.map((b) => b.id));
    await tx.activityEvent.create({
      data: {
        workspaceId: ctx.workspace.id, entityType: "Trash", entityId: ctx.workspace.id, action: "purged",
        summary: `${actor} emptied the Trash: ${batches.length} item${batches.length === 1 ? "" : "s"}, ${removed} record${removed === 1 ? "" : "s"} permanently deleted`,
        actorName: actor, createdAt: now,
      },
    });
    return { items: batches.length, removed };
  }, { timeout: 120_000 });
}

/**
 * Permanently delete batches that have been in Trash for 30 days. Cheap when there are none.
 * Runs as part of an editor's or owner's own action (viewers can't write), so there's no cron.
 */
export async function purgeExpiredTrash(ctx: WorkspaceContext, now = new Date()): Promise<number> {
  if (!hasRole(ctx.role, "EDITOR")) return 0;
  const db = scopedDb(ctx);
  const expired = await db.trashBatch.findMany({ where: { deletedAt: { lt: new Date(now.getTime() - TRASH_DAYS * DAY_MS) } } });
  if (!expired.length) return 0;
  return db.$transaction(async (tx) => {
    await purgeBatches(tx, expired.map((b) => b.id));
    for (const b of expired) {
      await tx.activityEvent.create({
        data: {
          workspaceId: ctx.workspace.id, entityType: RECORD_HANDLERS[b.entityType as EntityType]?.activityType ?? "Trash", entityId: b.id,
          action: "purged", summary: `${b.label} was permanently deleted after ${TRASH_DAYS} days in Trash`, actorName: "Trash", createdAt: now,
        },
      });
    }
    return expired.length;
  }, { timeout: 120_000 });
}

// ---------- Listing ----------

export type TrashItem = {
  id: string;
  type: EntityType;
  label: string;
  rootCount: number;
  contents: ContentsLine[];
  deletedBy: string;
  deletedAt: Date;
  expiresAt: Date;
  daysLeft: number;
};

/** Owners: what's in Trash, newest first. */
export async function listTrash(ctx: WorkspaceContext, now = new Date()): Promise<TrashItem[]> {
  requireRole(ctx, "OWNER", "Viewing the Trash");
  await purgeExpiredTrash(ctx, now);
  const batches = await scopedDb(ctx).trashBatch.findMany({ orderBy: { deletedAt: "desc" } });
  return batches.map((b) => ({
    id: b.id,
    type: b.entityType as EntityType,
    label: b.label,
    rootCount: (b.rootIds as string[]).length,
    contents: b.contents as ContentsLine[],
    deletedBy: b.deletedByName,
    deletedAt: b.deletedAt,
    expiresAt: new Date(b.deletedAt.getTime() + TRASH_DAYS * DAY_MS),
    daysLeft: Math.max(0, Math.ceil((b.deletedAt.getTime() + TRASH_DAYS * DAY_MS - now.getTime()) / DAY_MS)),
  }));
}

/** Number of items in Trash (for the Settings link). Any member may see the count. */
export async function countTrash(ctx: WorkspaceContext): Promise<number> {
  return scopedDb(ctx).trashBatch.count();
}

// Workspace-level helpers for lib/data/workspaces.ts, which checks the role and passes the
// unscoped transaction (trashed rows included).

/** Hard-delete every domain row of a workspace, children first (for deleting the workspace). */
export async function deleteAllDomainRows(tx: object, workspaceId: string) {
  for (const m of PURGE_ORDER) await model(tx, m).deleteMany({ where: { workspaceId } });
}

/** Drop Trash items whose rows are all gone (e.g. after clearing demo data). */
export async function dropEmptyTrashBatches(tx: object, workspaceId: string) {
  const t = tx as RecordTx;
  for (const b of await t.trashBatch.findMany({ where: { workspaceId }, select: { id: true } })) {
    let left = 0;
    for (const m of PURGE_ORDER) left += await model(tx, m).count({ where: { workspaceId, trashBatchId: b.id } });
    if (!left) await t.trashBatch.deleteMany({ where: { id: b.id, workspaceId } });
  }
}
