// Create, edit and list domain records for the current workspace.
//
// saveRecord() is the only write path for forms:
//   1. role check (editors and owners; scopedDb also blocks viewers);
//   2. the record's zod schema (lib/records/*), giving per-field errors;
//   3. the same cross-record checks the browser ran, against fresh workspace data;
//   4. server-only rules (uniqueness, existing children that constrain an edit);
//   5. one transaction: the write, derived values (ratings, cohort status, checklist)
//      and an ActivityEvent for "What changed".
import { requireRole, type WorkspaceContext } from "@/lib/auth/access";
import { scopedDb } from "@/lib/data/scoped";
import { mean, round2, sentimentForRating } from "@/lib/domain/feedback";
import { CHECKLIST_TEMPLATE } from "@/lib/demo/fixtures";
import { parseFilters, type FilterState } from "@/lib/filters";
import {
  DAY_MS, enumLabel, isoDate, makeLookup, refOptions,
  type FieldErrors, type FormOptions, type Lookup, type Values,
} from "@/lib/records/kit";
import { RECORDS } from "@/lib/records/registry";
import type { EntityType } from "@/lib/search-types";

type Row = Record<string, unknown> & { id: string };
type Data = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof scopedDb>["$transaction"]>[0]>[0];
type Delegate = {
  findUnique(a: object): Promise<Row | null>;
  findFirst(a: object): Promise<Row | null>;
  findMany(a: object): Promise<Row[]>;
  count(a?: object): Promise<number>;
  aggregate(a: object): Promise<{ _max: Record<string, number | null> }>;
  create(a: object): Promise<Row>;
  createMany(a: object): Promise<{ count: number }>;
  update(a: object): Promise<Row>;
};
const model = (client: object, name: string) => (client as Record<string, Delegate>)[name];

export type SaveResult = { ok: true; id: string; label: string } | { ok: false; errors: FieldErrors };

// ---------- Options the forms pick from (and the checks look up) ----------

export async function getFormOptions(ctx: WorkspaceContext): Promise<FormOptions> {
  const db = scopedDb(ctx);
  const [courses, cohorts, modules, instructors, smes, sessions] = await Promise.all([
    db.course.findMany({ select: { id: true, code: true, name: true, region: true }, orderBy: { code: "asc" } }),
    db.cohort.findMany({
      select: { id: true, code: true, name: true, courseId: true, startDate: true, endDate: true, enrolledLearners: true },
      orderBy: { code: "asc" },
    }),
    db.module.findMany({ select: { id: true, title: true, courseId: true }, orderBy: [{ courseId: "asc" }, { order: "asc" }] }),
    db.instructor.findMany({ select: { id: true, name: true, hiringStage: true }, orderBy: { name: "asc" } }),
    db.sME.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.session.findMany({
      select: {
        id: true, title: true, cohortId: true, status: true, scheduledAt: true, attendance: true, instructorId: true,
        _count: { select: { feedback: true } },
      },
      orderBy: { scheduledAt: "desc" },
    }),
  ]);
  return {
    courses,
    cohorts: cohorts.map((c) => ({ ...c, startDate: c.startDate.toISOString(), endDate: c.endDate.toISOString() })),
    modules,
    instructors,
    smes,
    sessions: sessions.map(({ _count, scheduledAt, ...s }) => ({ ...s, scheduledAt: scheduledAt.toISOString(), feedbackCount: _count.feedback })),
  };
}

// ---------- Per-type persistence ----------

type Handler = {
  model: string;
  activityType: string;
  toValues(row: Row): Values;
  display(row: Row): string;
  /** Server-only rules that need the database. */
  serverChecks?(db: ReturnType<typeof scopedDb>, data: Data, existing: Row | null): Promise<FieldErrors>;
  /** Parsed form data -> Prisma data (flat), including derived fields. Runs inside the write transaction. */
  toData(data: Data, c: { lookup: Lookup; now: Date; db: Tx; existing: Row | null }): Promise<Data> | Data;
  /** Derived writes inside the transaction, after the record is saved. */
  after?(tx: Tx, row: Row, before: Row | null, ctx: WorkspaceContext): Promise<void>;
};

const str = (v: unknown) => (v == null ? "" : String(v));
const dateVal = (v: unknown) => (v instanceof Date ? isoDate(v) : "");
const dateTimeVal = (v: unknown) => (v instanceof Date ? v.toISOString() : "");
const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, str(row[k])]));

async function unique(db: ReturnType<typeof scopedDb>, m: string, field: string, value: unknown, existing: Row | null, message: string) {
  const clash = await model(db, m).findFirst({ where: { [field]: value, ...(existing ? { NOT: { id: existing.id } } : {}) } });
  return clash ? { [field]: message } : {};
}

function cohortStatus(start: Date, end: Date, now: Date) {
  if (now < start) return "UPCOMING";
  if (now.getTime() >= end.getTime() + DAY_MS) return "COMPLETED";
  return "ACTIVE";
}

/** Session avgRating = mean of its feedback when it has any (else keep the manual value); then the instructor's mean. */
async function recomputeRatings(tx: Tx, sessionIds: (string | null | undefined)[], instructorIds: (string | null | undefined)[]) {
  for (const id of new Set(sessionIds.filter(Boolean) as string[])) {
    const ratings = (await tx.learnerFeedback.findMany({ where: { sessionId: id }, select: { rating: true } })).map((f) => f.rating);
    if (ratings.length) {
      const s = await tx.session.update({ where: { id }, data: { avgRating: round2(mean(ratings)!) }, select: { instructorId: true } });
      instructorIds.push(s.instructorId);
    }
  }
  for (const id of new Set(instructorIds.filter(Boolean) as string[])) {
    const avgs = (await tx.session.findMany({ where: { instructorId: id, avgRating: { not: null } }, select: { avgRating: true } }))
      .map((s) => s.avgRating!);
    const m = mean(avgs);
    await tx.instructor.update({ where: { id }, data: { rating: m == null ? null : round2(m) } });
  }
}

const HANDLERS: Record<EntityType, Handler> = {
  course: {
    model: "course", activityType: "Course",
    toValues: (r) => pick(r, ["code", "name", "region", "track", "status", "description"]),
    display: (r) => `${r.code} ${r.name}`,
    serverChecks: (db, d, ex) => unique(db, "course", "code", d.code, ex, `Another course already uses ${d.code}.`),
    toData: (d) => d,
  },
  cohort: {
    model: "cohort", activityType: "Cohort",
    toValues: (r) => ({ ...pick(r, ["courseId", "code", "name", "capacity", "enrolledLearners", "health"]), startDate: dateVal(r.startDate), endDate: dateVal(r.endDate) }),
    display: (r) => String(r.code),
    async serverChecks(db, d, ex): Promise<FieldErrors> {
      const e: FieldErrors = await unique(db, "cohort", "code", d.code, ex, `Another cohort already uses ${d.code}.`);
      if (!ex) return e;
      const [sessions, projects, launches, feedback] = await Promise.all([
        db.session.findMany({ where: { cohortId: ex.id }, select: { scheduledAt: true, attendance: true } }),
        db.project.findMany({ where: { cohortId: ex.id }, select: { submissions: true, dueDate: true } }),
        db.launch.count({ where: { cohortId: ex.id } }),
        db.learnerFeedback.findMany({ where: { cohortId: ex.id }, select: { learnerId: true } }),
      ]);
      const enrolled = d.enrolledLearners as number;
      const maxAttendance = Math.max(0, ...sessions.map((s) => s.attendance ?? 0));
      const maxSubmissions = Math.max(0, ...projects.map((p) => p.submissions));
      const maxLearner = Math.max(0, ...feedback.map((f) => Number(f.learnerId.match(/-L(\d+)$/)?.[1] ?? 0)));
      const floor = Math.max(maxAttendance, maxSubmissions, maxLearner);
      if (enrolled < floor) e.enrolledLearners = `At least ${floor}: existing sessions, projects or feedback already count that many learners.`;
      const start = d.startDate as Date;
      const endExclusive = (d.endDate as Date).getTime() + DAY_MS;
      const outside = [...sessions.map((s) => s.scheduledAt), ...projects.map((p) => p.dueDate)]
        .filter((t) => t < start || t.getTime() >= endExclusive).length;
      if (outside) e.endDate = `${outside} session${outside === 1 ? "" : "s"} or project${outside === 1 ? "" : "s"} would fall outside these dates.`;
      if (d.courseId !== ex.courseId && (sessions.length || projects.length || launches)) {
        e.courseId = "This cohort already has sessions, projects or launches, so its course can't change.";
      }
      return e;
    },
    toData: (d, { now }) => ({ ...d, status: cohortStatus(d.startDate as Date, d.endDate as Date, now) }),
  },
  instructor: {
    model: "instructor", activityType: "Instructor",
    toValues: (r) => ({ ...pick(r, ["name", "email", "expertise", "region", "hiringStage"]), joinedAt: dateVal(r.joinedAt) }),
    display: (r) => String(r.name),
    serverChecks: (db, d, ex) => unique(db, "instructor", "email", d.email, ex, `Another instructor already uses ${d.email}.`),
    toData: (d) => d,
  },
  sme: {
    model: "sME", activityType: "SME",
    toValues: (r) => pick(r, ["name", "email", "domain", "company", "hoursPerWeek", "hiringStage"]),
    display: (r) => String(r.name),
    serverChecks: (db, d, ex) => unique(db, "sME", "email", d.email, ex, `Another SME already uses ${d.email}.`),
    toData: (d) => d,
  },
  module: {
    model: "module", activityType: "Module",
    toValues: (r) => ({ ...pick(r, ["courseId", "title", "description", "tags", "stage", "ownerName", "reviewerId"]), dueDate: dateVal(r.dueDate) }),
    display: (r) => String(r.title),
    async serverChecks(db, d, ex): Promise<FieldErrors> {
      if (ex && d.courseId !== ex.courseId && (await db.session.count({ where: { moduleId: ex.id } }))) {
        return { courseId: "Sessions already teach this module, so its course can't change." };
      }
      return {};
    },
    async toData(d, { db, existing }) {
      if (existing && existing.courseId === d.courseId) return { ...d, updatedAt: new Date() };
      const max = await db.module.aggregate({ where: { courseId: d.courseId as string }, _max: { order: true } });
      return { ...d, order: (max._max.order ?? 0) + 1, updatedAt: new Date() };
    },
  },
  session: {
    model: "session", activityType: "Session",
    toValues: (r) => ({
      ...pick(r, ["cohortId", "moduleId", "instructorId", "smeId", "title", "durationMin", "status", "attendance", "avgRating"]),
      scheduledAt: dateTimeVal(r.scheduledAt),
    }),
    display: (r) => String(r.title),
    async serverChecks(db, d, ex): Promise<FieldErrors> {
      if (ex && d.cohortId !== ex.cohortId && (await db.learnerFeedback.count({ where: { sessionId: ex.id } }))) {
        return { cohortId: "This session has feedback from its cohort's learners, so its cohort can't change." };
      }
      return {};
    },
    toData(d) {
      const completed = d.status === "COMPLETED";
      return {
        ...d,
        attendance: completed ? d.attendance : null,
        // Feedback-derived ratings are recomputed in after(); a manual one only when there's no feedback.
        avgRating: completed && d.avgRating != null ? round2(d.avgRating as number) : null,
      };
    },
    async after(tx, row, before) {
      const hasFeedback = before ? (await tx.learnerFeedback.count({ where: { sessionId: row.id } })) > 0 : false;
      await recomputeRatings(tx, hasFeedback ? [row.id] : [], [row.instructorId as string, before?.instructorId as string]);
    },
  },
  feedback: {
    model: "learnerFeedback", activityType: "LearnerFeedback",
    toValues: (r) => ({
      ...pick(r, ["sessionId", "rating", "theme", "comment"]),
      learnerNumber: String(Number(String(r.learnerId).match(/-L(\d+)$/)?.[1] ?? "")),
      createdAt: dateTimeVal(r.createdAt),
    }),
    display: (r) => `${r.learnerId} (${r.rating}★)`,
    async serverChecks(db, d, ex): Promise<FieldErrors> {
      const session = await db.session.findUnique({ where: { id: d.sessionId as string }, select: { cohort: { select: { code: true } } } });
      if (!session) return { sessionId: "That session doesn't exist in this workspace." };
      const learnerId = `${session.cohort.code}-L${String(d.learnerNumber).padStart(3, "0")}`;
      const dup = await db.learnerFeedback.findFirst({
        where: { sessionId: d.sessionId as string, learnerId, ...(ex ? { NOT: { id: ex.id } } : {}) },
      });
      return dup ? { learnerNumber: `Learner ${learnerId} already left feedback on this session.` } : {};
    },
    toData(d, { lookup }) {
      const session = lookup.session(d.sessionId as string)!;
      const cohort = lookup.cohort(session.cohortId)!;
      const { learnerNumber, ...rest } = d;
      return {
        ...rest,
        cohortId: cohort.id,
        learnerId: `${cohort.code}-L${String(learnerNumber).padStart(3, "0")}`,
        sentiment: sentimentForRating(d.rating as number),
      };
    },
    async after(tx, row, before) {
      await recomputeRatings(tx, [row.sessionId as string, before?.sessionId as string], []);
    },
  },
  issue: {
    model: "issue", activityType: "Issue",
    toValues: (r) => ({
      ...pick(r, ["title", "description", "category", "severity", "status", "ownerName", "courseId", "cohortId", "sessionId"]),
      openedAt: dateTimeVal(r.openedAt), resolvedAt: dateTimeVal(r.resolvedAt),
    }),
    display: (r) => `${r.code} ${r.title}`,
    async toData(d, { lookup, db, existing }) {
      // Fill in the links above the most specific one chosen, so they always agree.
      const session = lookup.session(d.sessionId as string | null);
      const cohortId = (d.cohortId as string | null) ?? session?.cohortId ?? null;
      const courseId = (d.courseId as string | null) ?? lookup.cohort(cohortId)?.courseId ?? null;
      const out: Data = { ...d, cohortId, courseId, resolvedAt: d.status === "RESOLVED" ? d.resolvedAt : null };
      if (!existing) {
        const codes = await db.issue.findMany({ select: { code: true } });
        const max = Math.max(100, ...codes.map((c) => Number(c.code.match(/^ISS-(\d+)$/)?.[1] ?? 0)));
        out.code = `ISS-${max + 1}`;
      }
      return out;
    },
  },
  project: {
    model: "project", activityType: "Project",
    toValues: (r) => ({ ...pick(r, ["courseId", "cohortId", "title", "description", "type", "status", "submissions", "avgScore"]), dueDate: dateVal(r.dueDate) }),
    display: (r) => String(r.title),
    toData: (d) => ({ ...d, avgScore: d.status === "COMPLETED" ? Math.round((d.avgScore as number) * 10) / 10 : null }),
  },
  launch: {
    model: "launch", activityType: "Launch",
    toValues: (r) => ({ ...pick(r, ["name", "courseId", "cohortId", "status", "ownerName"]), targetDate: dateVal(r.targetDate) }),
    display: (r) => String(r.name),
    toData: (d) => d,
    async after(tx, row, before, ctx) {
      if (before) return;
      // New launches start with the standard readiness checklist, owned by the launch owner.
      const target = row.targetDate as Date;
      await tx.checklistItem.createMany({
        data: CHECKLIST_TEMPLATE.map((t) => ({
          workspaceId: ctx.workspace.id, launchId: row.id, label: t.label, ownerName: row.ownerName as string,
          dueDate: new Date(target.getTime() - t.daysBefore * DAY_MS), done: false,
        })),
      });
    },
  },
};

// ---------- Activity summaries ----------

function formatValue(type: EntityType, field: string, value: string, o: FormOptions): string {
  if (!value) return "—";
  const f = RECORDS[type].fields.find((x) => x.name === field);
  if (f?.kind === "select") return f.options?.find((x) => x.value === value)?.label ?? enumLabel(value);
  if (f?.kind === "ref" && f.ref) return refOptions(f.ref, o).find((x) => x.value === value)?.label.split(" · ")[0] ?? value;
  if (f?.kind === "datetime") return value.slice(0, 16).replace("T", " ");
  return value.length > 40 ? `${value.slice(0, 39)}…` : value;
}

function describeChanges(type: EntityType, before: Values, after: Values, o: FormOptions) {
  const changed = RECORDS[type].fields.filter((f) => (before[f.name] ?? "") !== (after[f.name] ?? ""));
  const parts = changed.slice(0, 3).map((f) => `${f.label} ${formatValue(type, f.name, before[f.name], o)} → ${formatValue(type, f.name, after[f.name], o)}`);
  if (changed.length > 3) parts.push(`+${changed.length - 3} more`);
  return { changed, text: parts.join("; ") };
}

// ---------- Public API ----------

/** Form values for an existing record, or null when it isn't in this workspace. */
export async function getRecordForEdit(ctx: WorkspaceContext, type: EntityType, id: string): Promise<Values | null> {
  const h = HANDLERS[type];
  const row = await model(scopedDb(ctx), h.model).findUnique({ where: { id } });
  return row ? { ...h.toValues(row), _id: row.id, _instructorId: str(row.instructorId) } : null;
}

/** Shared lookups for validating one record or a whole import batch. */
export type ValidationContext = { options: FormOptions; lookup: Lookup; now: Date };

export async function validationContext(ctx: WorkspaceContext, now = new Date()): Promise<ValidationContext> {
  const options = await getFormOptions(ctx);
  return { options, lookup: makeLookup(options), now };
}

export type Validated =
  | { ok: true; data: Data; existing: Row | null; before: Values | undefined }
  | { ok: false; errors: FieldErrors };

/**
 * Everything the Add/Edit forms enforce, without writing: schema, cross-record checks,
 * then server-only rules. Callers check the role. Used by saveRecord and by imports.
 */
export async function validateRecord(
  ctx: WorkspaceContext,
  type: EntityType,
  existing: Row | null,
  values: Values,
  vc: ValidationContext,
): Promise<Validated> {
  const def = RECORDS[type];
  const h = HANDLERS[type];
  const before = existing ? { ...h.toValues(existing), _id: existing.id } : undefined;
  const parsed = def.schema.safeParse(values);
  if (!parsed.success) {
    const errors: FieldErrors = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? "_form")] ??= issue.message;
    return { ok: false, errors };
  }
  const data = parsed.data as Data;
  const errors = { ...def.checks?.(data, { lookup: vc.lookup, now: vc.now, existing: before }) };
  if (Object.keys(errors).length === 0) Object.assign(errors, await h.serverChecks?.(scopedDb(ctx), data, existing));
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data, existing, before };
}

/** Write a validated record inside the caller's transaction, with derived values. Optionally logs its own ActivityEvent. */
export async function persistRecord(
  tx: Tx,
  ctx: WorkspaceContext,
  type: EntityType,
  v: Extract<Validated, { ok: true }>,
  vc: ValidationContext,
  opts: { logActivity: boolean },
): Promise<Row> {
  const def = RECORDS[type];
  const h = HANDLERS[type];
  const { data, existing, before } = v;
  const toWrite = await h.toData(data, { lookup: vc.lookup, now: vc.now, db: tx, existing });
  const m = model(tx, h.model);
  const saved = existing
    ? await m.update({ where: { id: existing.id }, data: toWrite })
    : await m.create({ data: { ...toWrite, workspaceId: ctx.workspace.id } });
  await h.after?.(tx, saved, existing, ctx);
  if (!opts.logActivity) return saved;

  const actor = ctx.user.name ?? ctx.user.email;
  if (!existing) {
    await tx.activityEvent.create({
      data: {
        workspaceId: ctx.workspace.id, entityType: h.activityType, entityId: saved.id, action: "created",
        summary: `${actor} added ${def.noun} ${h.display(saved)}`, actorName: actor, createdAt: vc.now,
      },
    });
  } else {
    const { changed, text } = describeChanges(type, before!, h.toValues(saved), vc.options);
    if (changed.length) {
      const statusField = changed.some((f) => ["status", "stage", "hiringStage"].includes(f.name));
      await tx.activityEvent.create({
        data: {
          workspaceId: ctx.workspace.id, entityType: h.activityType, entityId: saved.id,
          action: statusField ? "status_changed" : "updated",
          summary: `${actor} updated ${def.noun} ${h.display(saved)}: ${text}`, actorName: actor, createdAt: vc.now,
        },
      });
    }
  }
  return saved;
}

export const isUniqueViolation = (e: unknown) => typeof e === "object" && !!e && "code" in e && e.code === "P2002";

export async function saveRecord(
  ctx: WorkspaceContext,
  type: EntityType,
  id: string | null,
  values: Values,
  now = new Date(),
): Promise<SaveResult> {
  requireRole(ctx, "EDITOR", "Adding and editing records");
  const h = HANDLERS[type];
  const db = scopedDb(ctx);
  const existing = id ? await model(db, h.model).findUnique({ where: { id } }) : null;
  if (id && !existing) return { ok: false, errors: { _form: "That record doesn't exist in this workspace." } };

  const vc = await validationContext(ctx, now);
  const v = await validateRecord(ctx, type, existing, values, vc);
  if (!v.ok) return v;
  try {
    const row = await db.$transaction((tx) => persistRecord(tx, ctx, type, v, vc, { logActivity: true }), { timeout: 20_000 });
    return { ok: true, id: row.id, label: h.display(row) };
  } catch (e) {
    // A concurrent save can still hit a unique constraint after our checks passed.
    if (isUniqueViolation(e)) {
      return { ok: false, errors: { _form: "Another record with the same code or email was just saved. Change it and try again." } };
    }
    throw e;
  }
}

/** Every record of a type as form values (for import matching and diffs). */
export async function listRecordValues(ctx: WorkspaceContext, type: EntityType): Promise<{ row: Row; values: Values; label: string }[]> {
  const h = HANDLERS[type];
  const rows = await model(scopedDb(ctx), h.model).findMany({});
  return rows.map((row) => ({ row, values: h.toValues(row), label: h.display(row) }));
}

/** Changed fields between two value sets, labelled and formatted like the activity log. */
export function fieldChanges(type: EntityType, before: Values, after: Values, o: FormOptions) {
  return RECORDS[type].fields
    .filter((f) => (before[f.name] ?? "") !== (after[f.name] ?? ""))
    .map((f) => ({ field: f.label, from: formatValue(type, f.name, before[f.name] ?? "", o), to: formatValue(type, f.name, after[f.name] ?? "", o) }));
}

export { HANDLERS as RECORD_HANDLERS, type Row as RecordRow, type Tx as RecordTx };

// ---------- Section tables ----------

export type RecordTable = { type: EntityType; columns: string[]; rows: { id: string; cells: string[]; demo: boolean }[]; total: number };

const LIST_LIMIT = 50;
const day = (d: Date | null | undefined) => (d ? isoDate(d) : "—");
const lbl = (v: string | null | undefined) => (v ? enumLabel(v) : "—");

/** The records a section page lists, honouring the course/cohort/region URL filters. Your own records first. */
export async function listRecords(ctx: WorkspaceContext, type: EntityType, params: Parameters<typeof parseFilters>[0]): Promise<RecordTable> {
  const f: FilterState = parseFilters(params);
  const db = scopedDb(ctx);
  const course = { ...(f.course ? { code: f.course } : {}), ...(f.region ? { region: f.region } : {}) };
  const hasCourse = Object.keys(course).length > 0;
  const cohortWhere = { ...(f.cohort ? { code: f.cohort } : {}), ...(hasCourse ? { course } : {}) };
  const hasCohort = Object.keys(cohortWhere).length > 0;
  const page = { take: LIST_LIMIT };
  const demoLast = { isDemo: "asc" as const };

  const table = (columns: string[], total: number, rows: { id: string; isDemo: boolean }[], cells: (r: never) => string[]): RecordTable => ({
    type, columns, total, rows: rows.map((r) => ({ id: r.id, demo: r.isDemo, cells: cells(r as never) })),
  });

  switch (type) {
    case "course": {
      const where = course;
      const [rows, total] = await Promise.all([db.course.findMany({ where, orderBy: [demoLast, { code: "asc" }], ...page }), db.course.count({ where })]);
      return table(["Code", "Name", "Region", "Status"], total, rows, (r: (typeof rows)[number]) => [r.code, r.name, r.region, lbl(r.status)]);
    }
    case "cohort": {
      const where = cohortWhere;
      const [rows, total] = await Promise.all([
        db.cohort.findMany({ where, include: { course: { select: { code: true } } }, orderBy: [demoLast, { startDate: "desc" }], ...page }),
        db.cohort.count({ where }),
      ]);
      return table(["Code", "Course", "Dates", "Learners", "Status", "Health"], total, rows, (r: (typeof rows)[number]) => [
        r.code, r.course.code, `${day(r.startDate)} → ${day(r.endDate)}`, `${r.enrolledLearners}/${r.capacity}`, lbl(r.status), lbl(r.health),
      ]);
    }
    case "launch": {
      const where = { ...(hasCourse ? { course } : {}), ...(f.cohort ? { cohort: { code: f.cohort } } : {}) };
      const [rows, total] = await Promise.all([
        db.launch.findMany({ where, include: { course: { select: { code: true } } }, orderBy: [demoLast, { targetDate: "desc" }], ...page }),
        db.launch.count({ where }),
      ]);
      return table(["Name", "Course", "Target", "Status", "Owner"], total, rows, (r: (typeof rows)[number]) => [r.name, r.course.code, day(r.targetDate), lbl(r.status), r.ownerName]);
    }
    case "module": {
      const where = hasCourse ? { course } : {};
      const [rows, total] = await Promise.all([
        db.module.findMany({ where, include: { course: { select: { code: true } } }, orderBy: [demoLast, { courseId: "asc" }, { order: "asc" }], ...page }),
        db.module.count({ where }),
      ]);
      return table(["Title", "Course", "Stage", "Owner", "Due"], total, rows, (r: (typeof rows)[number]) => [r.title, r.course.code, lbl(r.stage), r.ownerName, day(r.dueDate)]);
    }
    case "instructor": {
      const where = f.region ? { region: f.region } : {};
      const [rows, total] = await Promise.all([db.instructor.findMany({ where, orderBy: [demoLast, { name: "asc" }], ...page }), db.instructor.count({ where })]);
      return table(["Name", "Expertise", "Region", "Stage", "Rating"], total, rows, (r: (typeof rows)[number]) => [
        r.name, r.expertise.split(",").join(", "), r.region, lbl(r.hiringStage), r.rating?.toFixed(2) ?? "—",
      ]);
    }
    case "sme": {
      const [rows, total] = await Promise.all([db.sME.findMany({ orderBy: [demoLast, { name: "asc" }], ...page }), db.sME.count()]);
      return table(["Name", "Domain", "Company", "Stage"], total, rows, (r: (typeof rows)[number]) => [r.name, r.domain, r.company, lbl(r.hiringStage)]);
    }
    case "project": {
      const where = hasCohort ? { cohort: cohortWhere } : {};
      const [rows, total] = await Promise.all([
        db.project.findMany({ where, include: { cohort: { select: { code: true } } }, orderBy: [demoLast, { dueDate: "desc" }], ...page }),
        db.project.count({ where }),
      ]);
      return table(["Title", "Cohort", "Type", "Status", "Due", "Submissions"], total, rows, (r: (typeof rows)[number]) => [
        r.title, r.cohort.code, lbl(r.type), lbl(r.status), day(r.dueDate), String(r.submissions),
      ]);
    }
    case "issue": {
      const where = {
        ...(hasCourse ? { course } : {}),
        ...(f.cohort ? { cohort: { code: f.cohort } } : {}),
      };
      const [rows, total] = await Promise.all([db.issue.findMany({ where, orderBy: [demoLast, { openedAt: "desc" }], ...page }), db.issue.count({ where })]);
      return table(["Code", "Title", "Severity", "Status", "Owner", "Opened"], total, rows, (r: (typeof rows)[number]) => [
        r.code, r.title, lbl(r.severity), lbl(r.status), r.ownerName ?? "Unassigned", day(r.openedAt),
      ]);
    }
    case "session": {
      const where = hasCohort ? { cohort: cohortWhere } : {};
      const [rows, total] = await Promise.all([
        db.session.findMany({ where, include: { cohort: { select: { code: true } } }, orderBy: [demoLast, { scheduledAt: "desc" }], ...page }),
        db.session.count({ where }),
      ]);
      return table(["Title", "Cohort", "When", "Status", "Attendance", "Rating"], total, rows, (r: (typeof rows)[number]) => [
        r.title, r.cohort.code, `${r.scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, lbl(r.status),
        r.attendance == null ? "—" : String(r.attendance), r.avgRating?.toFixed(2) ?? "—",
      ]);
    }
    case "feedback": {
      const where = hasCohort ? { cohort: cohortWhere } : {};
      const [rows, total] = await Promise.all([
        db.learnerFeedback.findMany({
          where, include: { cohort: { select: { code: true } }, session: { select: { title: true } } },
          orderBy: [demoLast, { createdAt: "desc" }], ...page,
        }),
        db.learnerFeedback.count({ where }),
      ]);
      return table(["Comment", "Rating", "Theme", "Cohort", "Session"], total, rows, (r: (typeof rows)[number]) => [
        r.comment, `${r.rating}★`, r.theme, r.cohort.code, r.session.title,
      ]);
    }
  }
}
