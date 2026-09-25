// Building blocks for record forms. Pure (no Prisma, no Next), so the same schemas and
// consistency checks run in the browser for instant feedback and on the server for real.
import { z } from "zod";
import type { EntityType } from "@/lib/search-types";

// ---------- Form values and errors ----------

/** Raw form values: every field is a string ("" when empty), as typed or chosen. */
export type Values = Record<string, string>;
/** First error per field; "_form" for errors that aren't about one field. */
export type FieldErrors = Record<string, string>;

export function zodErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_form");
    out[key] ??= issue.message;
  }
  return out;
}

// ---------- Field parsers (string in, typed value out, readable messages) ----------

const fail = (c: z.RefinementCtx, message: string) => {
  c.addIssue({ code: "custom", message });
  return z.NEVER;
};

export const text = (label: string, max = 120) =>
  z.string().trim().transform((v, c) =>
    !v ? fail(c, `${label} is required.`) : v.length > max ? fail(c, `${label} must be ${max} characters or fewer.`) : v,
  );

export const optText = (label: string, max = 120) =>
  z.string().trim().transform((v, c) => (v.length > max ? fail(c, `${label} must be ${max} characters or fewer.`) : v || null));

function toNumber(v: string, label: string, min: number, max: number, int: boolean, c: z.RefinementCtx) {
  const n = Number(v);
  if (!Number.isFinite(n) || (int && !Number.isInteger(n))) return fail(c, `${label} must be a ${int ? "whole " : ""}number.`);
  if (n < min || n > max) return fail(c, `${label} must be between ${min} and ${max}.`);
  return n;
}

export const num = (label: string, min: number, max: number, int = true) =>
  z.string().trim().transform((v, c) => (!v ? fail(c, `${label} is required.`) : toNumber(v, label, min, max, int, c)));

export const optNum = (label: string, min: number, max: number, int = true) =>
  z.string().trim().transform((v, c): number | null => (!v ? null : toNumber(v, label, min, max, int, c)));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date (YYYY-MM-DD), stored as UTC midnight. Rejects impossible dates like 2026-02-30. */
export const date = (label: string) =>
  z.string().trim().transform((v, c) => {
    if (!v) return fail(c, `${label} is required.`);
    const d = new Date(`${v}T00:00:00Z`);
    if (!DATE_RE.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return fail(c, `${label} isn't a valid date.`);
    return d;
  });

function toDateTime(v: string, label: string, c: z.RefinementCtx) {
  const d = new Date(v);
  // The client sends full ISO strings (converted from the browser's local time).
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(d.getTime())) return fail(c, `${label} isn't a valid date and time.`);
  return d;
}

export const dateTime = (label: string) =>
  z.string().trim().transform((v, c) => (!v ? fail(c, `${label} is required.`) : toDateTime(v, label, c)));

export const optDateTime = (label: string) =>
  z.string().trim().transform((v, c): Date | null => (!v ? null : toDateTime(v, label, c)));

export const choice = <T extends string>(label: string, values: readonly T[]) =>
  z.string().transform((v, c) => ((values as readonly string[]).includes(v) ? (v as T) : fail(c, `Choose a ${label.toLowerCase()}.`)));

export const ref = (label: string) => z.string().trim().transform((v, c) => v || fail(c, `Choose a ${label.toLowerCase()}.`));
export const optRef = () => z.string().trim().transform((v) => v || null);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const email = (label = "Email") =>
  z.string().trim().toLowerCase().transform((v, c) => (!v ? fail(c, `${label} is required.`) : EMAIL_RE.test(v) ? v : fail(c, `Enter a valid email address.`)));

/** Comma-separated tags, normalized to lowercase-kebab, deduplicated, stored as "a,b,c". */
export const tags = (label: string, required = false) =>
  z.string().transform((v, c) => {
    const list = [...new Set(v.split(",").map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
    if (required && list.length === 0) return fail(c, `Add at least one ${label.toLowerCase()} tag.`);
    if (list.length > 12) return fail(c, `Use 12 ${label.toLowerCase()} tags or fewer.`);
    if (list.some((t) => t.length > 40)) return fail(c, `Tags must be 40 characters or fewer.`);
    return list.join(",");
  });

// ---------- Form field descriptions (rendered by components/records/record-form.tsx) ----------

export type RefKind = "course" | "cohort" | "module" | "instructor" | "sme" | "session";
export type Option = { value: string; label: string };

export type Field = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "date" | "datetime" | "select" | "ref" | "tags";
  required?: boolean;
  options?: readonly Option[];
  ref?: RefKind;
  hint?: string | ((v: Values, o: FormOptions) => string | null);
  placeholder?: string;
  step?: number;
  /** Narrow a ref picker's choices from other values (e.g. cohorts of the chosen course). */
  refFilter?: (id: string, v: Values, o: FormOptions) => boolean;
  /** Hide the field (and send "") unless this holds. */
  showIf?: (v: Values, o: FormOptions) => boolean;
  /** Render read-only with this explanation when it returns a string. */
  lockedIf?: (v: Values, o: FormOptions) => string | null;
  /** Full-width in the two-column layout. */
  wide?: boolean;
};

export const enumOptions = <T extends string>(values: readonly T[]): Option[] =>
  values.map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase().replaceAll("_", " ") }));

export const enumLabel = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replaceAll("_", " ");

// ---------- Related records the forms pick from and check against ----------
// Dates are ISO strings so the same data can cross the server/client boundary.

export type CourseOpt = { id: string; code: string; name: string; region: string };
export type CohortOpt = { id: string; code: string; name: string; courseId: string; startDate: string; endDate: string; enrolledLearners: number };
export type ModuleOpt = { id: string; title: string; courseId: string };
export type InstructorOpt = { id: string; name: string; hiringStage: string };
export type SmeOpt = { id: string; name: string };
export type SessionOpt = {
  id: string; title: string; cohortId: string; status: string; scheduledAt: string;
  attendance: number | null; feedbackCount: number; instructorId: string;
};

export type FormOptions = {
  courses: CourseOpt[];
  cohorts: CohortOpt[];
  modules: ModuleOpt[];
  instructors: InstructorOpt[];
  smes: SmeOpt[];
  sessions: SessionOpt[];
};

export type Lookup = {
  course(id: string | null): CourseOpt | undefined;
  cohort(id: string | null): CohortOpt | undefined;
  module(id: string | null): ModuleOpt | undefined;
  instructor(id: string | null): InstructorOpt | undefined;
  sme(id: string | null): SmeOpt | undefined;
  session(id: string | null): SessionOpt | undefined;
};

export function makeLookup(o: FormOptions): Lookup {
  const index = <T extends { id: string }>(rows: T[]) => {
    const m = new Map(rows.map((r) => [r.id, r]));
    return (id: string | null) => (id ? m.get(id) : undefined);
  };
  return {
    course: index(o.courses), cohort: index(o.cohorts), module: index(o.modules),
    instructor: index(o.instructors), sme: index(o.smes), session: index(o.sessions),
  };
}

export function refOptions(kind: RefKind, o: FormOptions): Option[] {
  switch (kind) {
    case "course": return o.courses.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }));
    case "cohort": return o.cohorts.map((c) => ({ value: c.id, label: `${c.code} · ${c.enrolledLearners} learners` }));
    case "module": return o.modules.map((m) => ({ value: m.id, label: m.title }));
    case "instructor": return o.instructors.map((i) => ({ value: i.id, label: i.hiringStage === "ACTIVE" ? i.name : `${i.name} (${enumLabel(i.hiringStage).toLowerCase()})` }));
    case "sme": return o.smes.map((s) => ({ value: s.id, label: s.name }));
    case "session": return o.sessions.map((s) => ({ value: s.id, label: `${s.title} · ${s.scheduledAt.slice(0, 10)}` }));
  }
}

// ---------- Record definitions ----------

export type CheckContext = {
  lookup: Lookup;
  now: Date;
  /** Values of the record as it was before this edit; undefined when creating. */
  existing?: Values;
};

export type RecordDef<T = unknown> = {
  type: EntityType;
  /** Singular, lowercase: "cohort", "learner feedback". */
  noun: string;
  schema: z.ZodType<T>;
  fields: Field[];
  /** Cross-field and cross-record rules. Runs after the schema passes, on client and server. */
  checks?: (data: T, c: CheckContext) => FieldErrors;
  /** Starting values for a new record. */
  defaults?: (o: FormOptions, now: Date) => Values;
};

export const defineRecord = <T>(def: RecordDef<T>) => def;

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const DAY_MS = 86_400_000;
