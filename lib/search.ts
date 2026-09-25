// Pure matching for the ⌘K palette: shared by the client and tests, no data access.
import { ENTITY_LABELS, type EntityType, type SearchField, type SearchItem } from "@/lib/search-types";

/** Result groups in palette order. Cohorts and launches come last. */
export const GROUP_ORDER: EntityType[] = [
  "course", "module", "project", "session", "issue", "feedback", "instructor", "sme", "cohort", "launch",
];
export const GROUP_LIMIT = 5;
const SNIPPET_CHARS = 90;

export type SearchHit = { item: SearchItem; snippet?: SearchField };
export type SearchGroup = { type: EntityType; label: string; hits: SearchHit[] };
export type Range = [start: number, end: number];

export function parseQuery(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/**
 * Case-insensitive, word-prefix matches: "rag" hits "RAG" and "rag,backend" but not
 * "storage" or "average". Returns merged, sorted [start, end) ranges.
 */
export function matchRanges(text: string, terms: string[]): Range[] {
  const lower = text.toLowerCase();
  const ranges: Range[] = [];
  for (const term of terms) {
    for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, i + 1)) {
      if (!isWordChar(lower[i - 1])) ranges.push([i, i + term.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

const hasTerm = (text: string, term: string) => matchRanges(text, [term]).length > 0;

/** True when every term matches somewhere in the given texts. */
export function matchesAll(texts: string[], terms: string[]): boolean {
  return terms.every((t) => texts.some((x) => hasTerm(x, t)));
}

/** Split text into plain and matched segments for rendering highlights. */
export function highlightSegments(text: string, terms: string[]): { text: string; match: boolean }[] {
  const out: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const [s, e] of matchRanges(text, terms)) {
    if (s > at) out.push({ text: text.slice(at, s), match: false });
    out.push({ text: text.slice(s, e), match: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out;
}

function excerpt(text: string, terms: string[]): string {
  if (text.length <= SNIPPET_CHARS) return text;
  const first = matchRanges(text, terms)[0]?.[0] ?? 0;
  let start = Math.max(0, Math.min(first - 30, text.length - SNIPPET_CHARS));
  // Don't open the excerpt mid-word.
  if (start > 0) start = Math.min(first, text.indexOf(" ", start) + 1 || first);
  const end = start + SNIPPET_CHARS;
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

// Lower is better: label starts with the query > label has every term >
// visible text has every term > matched only via hidden fields.
function rank(item: SearchItem, terms: string[]): number {
  if (matchRanges(item.label, [terms[0]])[0]?.[0] === 0) return 0;
  if (matchesAll([item.label], terms)) return 1;
  if (matchesAll([item.label, item.sublabel], terms)) return 2;
  return 3;
}

function hit(item: SearchItem, terms: string[]): SearchHit | null {
  const visible = [item.label, item.sublabel];
  if (!matchesAll([...visible, ...item.fields.map((f) => f.text)], terms)) return null;
  // Show where a match came from when it isn't visible in the label or sublabel.
  const hidden = terms.filter((t) => !visible.some((v) => hasTerm(v, t)));
  const field = hidden.length ? item.fields.find((f) => hidden.some((t) => hasTerm(f.text, t))) : undefined;
  return { item, snippet: field && { name: field.name, text: excerpt(field.text, terms) } };
}

/** Every matching record, grouped in GROUP_ORDER and ranked within each group. Empty groups are omitted. */
export function searchRecords(index: SearchItem[], query: string): SearchGroup[] {
  const terms = parseQuery(query);
  if (terms.length === 0) return [];
  const byType = new Map<EntityType, { hit: SearchHit; rank: number; pos: number }[]>();
  index.forEach((item, pos) => {
    const h = hit(item, terms);
    if (!h) return;
    const list = byType.get(item.type) ?? [];
    list.push({ hit: h, rank: rank(item, terms), pos });
    byType.set(item.type, list);
  });
  return GROUP_ORDER.flatMap((type) => {
    const list = byType.get(type);
    if (!list) return [];
    list.sort((a, b) => a.rank - b.rank || a.pos - b.pos);
    return [{ type, label: ENTITY_LABELS[type], hits: list.map((l) => l.hit) }];
  });
}

const FALLBACK_SUGGESTIONS = ["rag", "AIE-C1", "audio", "blocked", "capstone"];

/** Queries worth trying when a search finds nothing: single words from the query that do match, then known-good examples. */
export function suggestQueries(index: SearchItem[], query: string, max = 3): string[] {
  const terms = parseQuery(query);
  const candidates = [...(terms.length > 1 ? terms : []), ...FALLBACK_SUGGESTIONS];
  const out: string[] = [];
  for (const c of candidates) {
    if (out.length >= max) break;
    if (!out.includes(c) && c !== query.trim().toLowerCase() && searchRecords(index, c).length > 0) out.push(c);
  }
  return out;
}
