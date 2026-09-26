// Decide what each imported row does: create, update (matched by name), or nothing
// because it's invalid. Pure; the data layer then runs the Add form's validation.
import type { Values } from "@/lib/records/kit";
import { RECORDS } from "@/lib/records/registry";
import { MATCH_RULES, type ImportType } from "./mapping";

export type RowInput = {
  /** 1-based data row number (header excluded), as shown in the preview. */
  rowNumber: number;
  /** Normalized non-blank cells, by field name. Blank cells are simply absent. */
  values: Values;
  /** Cells that couldn't be normalized (bad date, unknown course, ...). */
  errors: string[];
};

export type ExistingRecord = { id: string; values: Values; label: string };

export type PlannedRow =
  | { rowNumber: number; kind: "new"; label: string; values: Values }
  | { rowNumber: number; kind: "update"; label: string; id: string; before: Values; values: Values }
  | { rowNumber: number; kind: "invalid"; label: string; reasons: string[] };

const norm = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** What rows are matched by: the normalized name, plus the course for modules. */
export function matchKey(type: ImportType, v: Values): string {
  const rule = MATCH_RULES[type];
  return `${norm(v[rule.nameField])}${rule.scopeField ? `|${v[rule.scopeField] ?? ""}` : ""}`;
}

export function planRows(type: ImportType, rows: RowInput[], existing: ExistingRecord[], defaults: Values): PlannedRow[] {
  const rule = MATCH_RULES[type];
  const fields = RECORDS[type].fields;
  const labelOf = (name: string) => fields.find((f) => f.name === name)?.label ?? name;
  const key = (v: Values) => matchKey(type, v);

  const byKey = new Map<string, ExistingRecord[]>();
  const byGuard = new Map<string, ExistingRecord>();
  for (const e of existing) {
    byKey.set(key(e.values), [...(byKey.get(key(e.values)) ?? []), e]);
    if (rule.guardField && e.values[rule.guardField]) byGuard.set(norm(e.values[rule.guardField]), e);
  }

  // Two rows aiming at the same record (same name, or same code/email) are both rejected.
  const keyCount = new Map<string, number[]>();
  const guardCount = new Map<string, number[]>();
  for (const r of rows) {
    if (r.values[rule.nameField]) keyCount.set(key(r.values), [...(keyCount.get(key(r.values)) ?? []), r.rowNumber]);
    const g = rule.guardField ? norm(r.values[rule.guardField]) : "";
    if (g) guardCount.set(g, [...(guardCount.get(g) ?? []), r.rowNumber]);
  }

  return rows.map((r): PlannedRow => {
    const name = r.values[rule.nameField] ?? "";
    const label = name || `Row ${r.rowNumber}`;
    const reasons = [...r.errors];
    if (!name) reasons.push(`${labelOf(rule.nameField)} is empty: rows are matched by it.`);
    if (rule.scopeField && !r.values[rule.scopeField] && !r.errors.some((e) => e.startsWith(labelOf(rule.scopeField!)))) {
      reasons.push(`${labelOf(rule.scopeField)} is empty: ${labelOf(rule.nameField).toLowerCase()}s are matched within their course.`);
    }
    if (reasons.length) return { rowNumber: r.rowNumber, kind: "invalid", label, reasons };

    const dupRows = keyCount.get(key(r.values))!;
    if (dupRows.length > 1) reasons.push(`Same ${labelOf(rule.nameField).toLowerCase()} as row${dupRows.length > 2 ? "s" : ""} ${dupRows.filter((n) => n !== r.rowNumber).join(", ")}.`);
    const g = rule.guardField ? norm(r.values[rule.guardField]) : "";
    const dupGuard = g ? guardCount.get(g)! : [];
    if (dupGuard.length > 1) reasons.push(`Same ${labelOf(rule.guardField!).toLowerCase()} as row${dupGuard.length > 2 ? "s" : ""} ${dupGuard.filter((n) => n !== r.rowNumber).join(", ")}.`);

    const matches = byKey.get(key(r.values)) ?? [];
    if (matches.length > 1) reasons.push(`${matches.length} existing records are named "${name}"; rename one so rows can be matched.`);
    const match = matches.length === 1 ? matches[0] : null;
    // The guard: a code/email that belongs to a different record means the names disagree.
    const owner = g ? byGuard.get(g) : undefined;
    if (owner && owner.id !== match?.id) {
      reasons.push(`${labelOf(rule.guardField!)} "${r.values[rule.guardField!]}" already belongs to "${owner.label}".`);
    }
    if (reasons.length) return { rowNumber: r.rowNumber, kind: "invalid", label, reasons };

    // Blank cells keep the existing value; new records start from the Add form's defaults.
    return match
      ? { rowNumber: r.rowNumber, kind: "update", label, id: match.id, before: match.values, values: { ...match.values, ...r.values } }
      : { rowNumber: r.rowNumber, kind: "new", label, values: { ...defaults, ...r.values } };
  });
}
