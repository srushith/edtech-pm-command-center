// Turn a raw cell (CSV text or a Google Sheets value) into the string the Add form's
// schema expects for that field. Pure. Anything ambiguous is an error, never a guess.
import type { Field, FormOptions } from "@/lib/records/kit";

export type Cell = string | number | boolean | null | undefined;
export type Normalized = { value: string } | { error: string };

const SHEETS_EPOCH = Date.UTC(1899, 11, 30); // Google Sheets / Excel serial day 0
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export const isBlank = (c: Cell) => c == null || (typeof c === "string" && c.trim() === "");

function ymd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

export function normalizeDate(cell: Cell, label: string): Normalized {
  if (typeof cell === "number") {
    // A date cell read from Google Sheets as a serial number.
    const d = new Date(SHEETS_EPOCH + Math.floor(cell) * 86_400_000);
    return { value: d.toISOString().slice(0, 10) };
  }
  const s = String(cell).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/); // 2026-09-01, 2026/9/1, ISO datetime
  if (m) return ymd(+m[1], +m[2], +m[3]) ? { value: ymd(+m[1], +m[2], +m[3])! } : { error: `${label}: "${s}" isn't a real date.` };
  m = s.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i); // 1 Sep 2026
  if (m && MONTHS.includes(m[2].toLowerCase())) {
    const v = ymd(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
    return v ? { value: v } : { error: `${label}: "${s}" isn't a real date.` };
  }
  m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i); // Sep 1, 2026
  if (m && MONTHS.includes(m[1].toLowerCase())) {
    const v = ymd(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
    return v ? { value: v } : { error: `${label}: "${s}" isn't a real date.` };
  }
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s)) {
    return { error: `${label}: "${s}" is ambiguous (day/month order). Use YYYY-MM-DD, e.g. 2026-09-01.` };
  }
  return { error: `${label}: "${s}" isn't a date. Use YYYY-MM-DD.` };
}

function normalizeNumber(cell: Cell, label: string): Normalized {
  if (typeof cell === "number") return { value: String(cell) };
  const s = String(cell).trim().replace(/(\d),(\d{3})\b/g, "$1$2");
  return /^-?\d+(\.\d+)?$/.test(s) ? { value: s } : { error: `${label}: "${String(cell).trim()}" isn't a number.` };
}

function normalizeChoice(cell: Cell, f: Field): Normalized {
  const s = String(cell).trim();
  const hit = f.options?.find((o) => loose(o.value) === loose(s) || loose(o.label) === loose(s));
  return hit ? { value: hit.value } : { error: `${f.label}: "${s}" isn't one of ${f.options?.map((o) => o.label).join(", ")}.` };
}

/** Resolve a linked record written as a code, name or email, within this workspace. */
function normalizeRef(cell: Cell, f: Field, o: FormOptions): Normalized {
  const s = String(cell).trim();
  const k = s.toLowerCase();
  const candidates =
    f.ref === "course" ? o.courses.filter((c) => c.code.toLowerCase() === k || c.name.toLowerCase() === k || c.id === s)
    : f.ref === "sme" ? o.smes.filter((x) => x.name.toLowerCase() === k || x.email.toLowerCase() === k || x.id === s)
    : f.ref === "cohort" ? o.cohorts.filter((c) => c.code.toLowerCase() === k || c.name.toLowerCase() === k || c.id === s)
    : f.ref === "instructor" ? o.instructors.filter((x) => x.name.toLowerCase() === k || x.id === s)
    : f.ref === "module" ? o.modules.filter((x) => x.title.toLowerCase() === k || x.id === s)
    : [];
  const noun = f.label.replace(/ \(.*\)$/, "").toLowerCase();
  if (candidates.length === 1) return { value: candidates[0].id };
  if (candidates.length > 1) return { error: `${f.label}: "${s}" matches ${candidates.length} records; use the ${f.ref === "course" ? "code" : "email"} instead.` };
  return { error: `${f.label}: no ${noun} "${s}" in this workspace.` };
}

export function normalizeCell(cell: Cell, f: Field, o: FormOptions): Normalized {
  if (isBlank(cell)) return { value: "" };
  switch (f.kind) {
    case "date": return normalizeDate(cell, f.label);
    case "number": return normalizeNumber(cell, f.label);
    case "select": return normalizeChoice(cell, f);
    case "ref": return normalizeRef(cell, f, o);
    case "tags": return { value: String(cell).replace(/;/g, ",").trim() };
    case "datetime": {
      if (typeof cell === "number") return { value: new Date(SHEETS_EPOCH + cell * 86_400_000).toISOString() };
      const d = new Date(String(cell).trim());
      return Number.isNaN(d.getTime()) ? { error: `${f.label}: "${String(cell).trim()}" isn't a date and time.` } : { value: d.toISOString() };
    }
    default: return { value: String(cell).trim() };
  }
}
