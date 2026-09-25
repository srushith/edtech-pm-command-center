// Which record types can be imported, their target fields, and column mapping helpers.
// Pure: used by the wizard in the browser and by the server.
import type { Field } from "@/lib/records/kit";
import { RECORDS } from "@/lib/records/registry";
import type { EntityType } from "@/lib/search-types";

export const IMPORT_TYPES = ["course", "cohort", "instructor", "sme", "module"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];
export const isImportType = (v: unknown): v is ImportType => typeof v === "string" && (IMPORT_TYPES as readonly string[]).includes(v);

/** column header -> field name, or null for "ignore". */
export type Mapping = Record<string, string | null>;

/** How rows find the record they update: by name (modules: title within their course), with code/email as a guard. */
export const MATCH_RULES: Record<ImportType, { nameField: string; guardField?: string; scopeField?: string }> = {
  course: { nameField: "name", guardField: "code" },
  cohort: { nameField: "name", guardField: "code" },
  instructor: { nameField: "name", guardField: "email" },
  sme: { nameField: "name", guardField: "email" },
  module: { nameField: "title", scopeField: "courseId" },
};

/** Import targets: the Add form's fields. Linked records are given by code, name or email. */
export function importFields(type: ImportType): Field[] {
  return RECORDS[type].fields.map((f) =>
    f.kind === "ref" ? { ...f, label: f.ref === "course" ? `${f.label} (code or name)` : `${f.label} (name or email)` } : f,
  );
}

/** Fields a mapping must include: the match key, plus (for modules) the course that scopes it. */
export function requiredMappedFields(type: ImportType): string[] {
  const r = MATCH_RULES[type];
  return [r.nameField, ...(r.scopeField ? [r.scopeField] : [])];
}

export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Deterministic, non-AI: a header that equals a field's name or label maps to it. */
export function exactMapping(type: ImportType, headers: string[]): Mapping {
  // A field answers to its name ("enrolledLearners") and its form label ("Enrolled learners").
  const names = RECORDS[type].fields.map((f) => ({ field: f.name, keys: [normalizeHeader(f.name), normalizeHeader(f.label)] }));
  const taken = new Set<string>();
  const out: Mapping = {};
  for (const h of headers) {
    const n = normalizeHeader(h);
    const hit = names.find((x) => !taken.has(x.field) && x.keys.includes(n));
    out[h] = hit ? hit.field : null;
    if (hit) taken.add(hit.field);
  }
  return out;
}

/** Stable identity for "the same set of columns" (order-insensitive), for remembering CSV mappings. */
export function headerSignature(headers: string[]): string {
  const text = [...headers].map(normalizeHeader).sort().join("|");
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${headers.length}-${h.toString(16).padStart(8, "0")}`;
}

/** Problems that stop a preview: required fields unmapped, or two columns on one field. */
export function mappingProblems(type: ImportType, mapping: Mapping): string[] {
  const problems: string[] = [];
  const fields = importFields(type);
  const used = new Map<string, string[]>();
  for (const [col, f] of Object.entries(mapping)) if (f) used.set(f, [...(used.get(f) ?? []), col]);
  for (const name of requiredMappedFields(type)) {
    if (!used.has(name)) problems.push(`Map a column to ${fields.find((f) => f.name === name)?.label ?? name}: rows are matched by it.`);
  }
  for (const [f, cols] of used) {
    if (cols.length > 1) problems.push(`${cols.map((c) => `"${c}"`).join(" and ")} both map to ${fields.find((x) => x.name === f)?.label ?? f}.`);
  }
  return problems;
}

export const IMPORT_NOUN = (t: EntityType) => RECORDS[t].noun;
