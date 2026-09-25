// CSV text -> headers + rows. Runs in the browser (instant headers) and in tests.
import Papa from "papaparse";

export const MAX_CSV_BYTES = 2 * 1024 * 1024;

export type ParsedTable = { headers: string[]; rows: string[][] };

/**
 * First non-empty line is the header row. Handles quoted commas/newlines, a UTF-8 BOM
 * (Excel adds one), blank lines, and repeated or empty header names.
 */
export function parseCsv(text: string): ParsedTable {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const [head = [], ...body] = result.data;
  const seen = new Map<string, number>();
  const headers = head.map((h, i) => {
    const base = h.trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const rows = body.map((r) => headers.map((_, i) => (r[i] ?? "").trim()));
  return { headers, rows };
}
