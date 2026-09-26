// CSV / Google Sheets imports for courses, cohorts, instructors, SMEs and modules.
//
// Rows go through exactly what the Add forms enforce (validateRecord), are matched to
// existing records by name (lib/import/match.ts), and are written in one transaction.
// Each import remembers its column mapping (ImportSource) so the next one from the same
// sheet or CSV layout is one click, records an ImportRun, and logs one ActivityEvent.
// For Google Sheets it also remembers which record each row became (ImportLink), so a row
// whose record was deleted in the app is skipped on the next sync instead of re-imported.
import { requireRole, type WorkspaceContext } from "@/lib/auth/access";
import { AIUnavailableError, describeAIMode, getAIProvider, type ColumnSuggestion } from "@/lib/ai/provider";
import { scopedDb } from "@/lib/data/scoped";
import { purgeExpiredTrash } from "@/lib/data/trash";
import {
  fieldChanges, isUniqueViolation, listRecordValues, persistRecord, validateRecord, validationContext,
  type RecordRow, type Validated, type ValidationContext,
} from "@/lib/data/records";
import { readSheet, sheetsAccessToken, type Fetch } from "@/lib/google/sheets";
import { matchKey, planRows, type ExistingRecord, type RowInput } from "@/lib/import/match";
import {
  exactMapping, headerSignature, importFields, mappingProblems, MATCH_RULES,
  type ImportType, type Mapping,
} from "@/lib/import/mapping";
import { normalizeCell, type Cell } from "@/lib/import/normalize";
import { RECORDS } from "@/lib/records/registry";

export const MAX_CSV_ROWS = 2000;
const MAX_STORED_ERRORS = 200;

/** A problem the user can fix (bad mapping, changed headers, ...). Messages are safe to show. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export type ImportSourceInput =
  | { kind: "CSV"; name: string; headers: string[]; rows: Cell[][] }
  | { kind: "SHEET"; spreadsheetId: string; sheetId: number };

export type ImportRequest = { type: ImportType; source: ImportSourceInput; mapping: Mapping };

export type PreviewRow = {
  rowNumber: number;
  kind: "new" | "update" | "unchanged" | "invalid" | "deleted";
  label: string;
  changes?: { field: string; from: string; to: string }[];
  reasons?: string[];
};

export type Preview = {
  type: ImportType;
  sourceName: string;
  counts: { new: number; update: number; unchanged: number; invalid: number; deleted: number };
  rows: PreviewRow[];
};

type LoadedRows = { name: string; headers: string[]; rows: Cell[][]; sheetTitle?: string };

export const sourceKeyFor = (s: ImportSourceInput, headers: string[]) =>
  s.kind === "SHEET" ? `sheet:${s.spreadsheetId}:${s.sheetId}` : `csv:${headerSignature(headers)}`;

// ---------- Loading and planning ----------

async function loadRows(ctx: WorkspaceContext, source: ImportSourceInput, fetchImpl: Fetch): Promise<LoadedRows> {
  if (source.kind === "CSV") {
    if (source.rows.length > MAX_CSV_ROWS) throw new ImportError(`This file has ${source.rows.length} rows; imports are limited to ${MAX_CSV_ROWS}.`);
    return { name: source.name, headers: source.headers, rows: source.rows };
  }
  const token = await sheetsAccessToken(ctx.user.id, fetchImpl);
  const data = await readSheet(token, source, fetchImpl);
  return { name: `${data.spreadsheetTitle} · ${data.tabTitle}`, headers: data.headers, rows: data.rows, sheetTitle: data.tabTitle };
}

type Planned = {
  preview: PreviewRow;
  write?: Extract<Validated, { ok: true }>;
  /** The row's match key, and the existing record it matched (update / unchanged). */
  key: string;
  matchedId?: string;
};

export const DELETED_IN_APP = "Deleted in the app after an earlier sync, so it isn't imported again.";

/** For a linked Google Sheet: the record each row became on earlier imports, by match key. */
async function sheetLinks(ctx: WorkspaceContext, type: ImportType, source: ImportSourceInput, headers: string[]): Promise<Map<string, string>> {
  if (source.kind !== "SHEET") return new Map();
  const db = scopedDb(ctx);
  const s = await db.importSource.findUnique({
    where: { workspaceId_entityType_sourceKey: { workspaceId: ctx.workspace.id, entityType: type, sourceKey: sourceKeyFor(source, headers) } },
    select: { id: true },
  });
  if (!s) return new Map();
  const links = await db.importLink.findMany({ where: { sourceId: s.id }, select: { matchKey: true, recordId: true } });
  return new Map(links.map((l) => [l.matchKey, l.recordId]));
}

/** Validation messages as row reasons, each naming its field. */
function reasonsFrom(type: ImportType, errors: Record<string, string>): string[] {
  return Object.entries(errors).map(([name, msg]) => {
    const label = RECORDS[type].fields.find((f) => f.name === name)?.label;
    return !label || msg.startsWith(label) ? msg : `${label}: ${msg}`;
  });
}

async function plan(
  ctx: WorkspaceContext,
  type: ImportType,
  data: LoadedRows,
  mapping: Mapping,
  vc: ValidationContext,
  links: Map<string, string>,
): Promise<Planned[]> {
  const problems = mappingProblems(type, mapping);
  if (problems.length) throw new ImportError(problems.join(" "));
  const fields = importFields(type);
  const columns = data.headers
    .map((h, i) => ({ i, field: fields.find((f) => f.name === mapping[h]) }))
    .filter((c): c is { i: number; field: (typeof fields)[number] } => !!c.field);

  const inputs: RowInput[] = data.rows.map((cells, r) => {
    const values: Record<string, string> = {};
    const errors: string[] = [];
    for (const { i, field } of columns) {
      const n = normalizeCell(cells[i], field, vc.options);
      if ("error" in n) errors.push(n.error);
      else if (n.value !== "") values[field.name] = n.value;
    }
    return { rowNumber: r + 1, values, errors };
  });

  const existingRows = await listRecordValues(ctx, type);
  const nameField = MATCH_RULES[type].nameField;
  const existing: ExistingRecord[] = existingRows.map((e) => ({ id: e.row.id, values: e.values, label: e.values[nameField] || e.label }));
  const rowById = new Map<string, RecordRow>(existingRows.map((e) => [e.row.id, e.row]));
  const defaults = RECORDS[type].defaults?.(vc.options, vc.now) ?? {};
  const planned = planRows(type, inputs, existing, defaults);

  // Validate like the Add form, a few rows at a time.
  const out: Planned[] = new Array(planned.length);
  for (let start = 0; start < planned.length; start += 25) {
    await Promise.all(
      planned.slice(start, start + 25).map(async (p, k) => {
        const idx = start + k;
        const key = matchKey(type, inputs[idx].values);
        if (p.kind === "invalid") {
          out[idx] = { key, preview: { rowNumber: p.rowNumber, kind: "invalid", label: p.label, reasons: p.reasons } };
          return;
        }
        // This sheet row became a record that has since been deleted (in Trash or purged).
        const linked = links.get(key);
        if (p.kind === "new" && linked && !rowById.has(linked)) {
          out[idx] = { key, preview: { rowNumber: p.rowNumber, kind: "deleted", label: p.label, reasons: [DELETED_IN_APP] } };
          return;
        }
        const existingRow = p.kind === "update" ? rowById.get(p.id)! : null;
        const matchedId = p.kind === "update" ? p.id : undefined;
        const v = await validateRecord(ctx, type, existingRow, p.values, vc);
        if (!v.ok) {
          out[idx] = { key, preview: { rowNumber: p.rowNumber, kind: "invalid", label: p.label, reasons: reasonsFrom(type, v.errors) } };
        } else if (p.kind === "update") {
          const changes = fieldChanges(type, p.before, p.values, vc.options);
          out[idx] = changes.length
            ? { key, matchedId, preview: { rowNumber: p.rowNumber, kind: "update", label: p.label, changes }, write: v }
            : { key, matchedId, preview: { rowNumber: p.rowNumber, kind: "unchanged", label: p.label } };
        } else {
          out[idx] = { key, preview: { rowNumber: p.rowNumber, kind: "new", label: p.label }, write: v };
        }
      }),
    );
  }
  return out;
}

function counts(rows: PreviewRow[]) {
  const c = { new: 0, update: 0, unchanged: 0, invalid: 0, deleted: 0 };
  for (const r of rows) c[r.kind]++;
  return c;
}

// ---------- Public API ----------

export type MappingHelp = {
  headers: string[];
  samples: Record<string, string[]>;
  /** The mapping saved for this source, if any; `savedMatches` is false when its columns changed. */
  saved: Mapping | null;
  savedMatches: boolean;
  /** Exact header-name matches (no AI). */
  exact: Mapping;
  /** AI suggestions, or null when AI isn't available. */
  ai: { provider: string; suggestions: ColumnSuggestion[] } | null;
  /** Why there are no AI suggestions (AI off, limit reached, provider error), if so. */
  aiNote: string | null;
  sourceName: string;
};

/** Headers, samples, the saved mapping for this source and suggestions, to start mapping. */
export async function prepareMapping(
  ctx: WorkspaceContext,
  type: ImportType,
  source: ImportSourceInput,
  fetchImpl: Fetch = fetch,
): Promise<MappingHelp> {
  requireRole(ctx, "EDITOR", "Importing");
  const data = await loadRows(ctx, source, fetchImpl);
  if (data.rows.length === 0) throw new ImportError("There are no data rows below the header row.");
  const samples: Record<string, string[]> = {};
  data.headers.forEach((h, i) => {
    samples[h] = data.rows.map((r) => r[i]).filter((c) => c != null && String(c).trim() !== "").slice(0, 3).map(String);
  });
  const saved = await scopedDb(ctx).importSource.findUnique({
    where: { workspaceId_entityType_sourceKey: { workspaceId: ctx.workspace.id, entityType: type, sourceKey: sourceKeyFor(source, data.headers) } },
  });
  // AI is optional: with no provider, or if it fails, mapping continues by hand.
  const { provider, mode } = await getAIProvider(ctx, { fetch: fetchImpl });
  const fields = importFields(type);
  let ai: MappingHelp["ai"] = null;
  let aiNote: string | null = provider ? null : describeAIMode(mode).detail;
  if (provider) {
    try {
      const suggestions = await provider.suggestColumnMapping({
        recordType: type,
        columns: data.headers.map((h) => ({ header: h, samples: samples[h] })),
        fields: fields.map((f) => ({ name: f.name, label: f.label, kind: f.kind, required: !!f.required, options: f.options?.map((o) => o.label) })),
      });
      ai = { provider: provider.name, suggestions };
    } catch (e) {
      if (!(e instanceof AIUnavailableError)) throw e;
      aiNote = `AI suggestions unavailable: ${e.message} Map columns by hand.`;
    }
  }
  return {
    headers: data.headers,
    samples,
    saved: (saved?.mapping as Mapping | undefined) ?? null,
    savedMatches: !!saved && saved.headerSignature === headerSignature(data.headers),
    exact: exactMapping(type, data.headers),
    ai,
    aiNote,
    sourceName: data.name,
  };
}

/** What an import would do, row by row. Writes nothing. */
export async function previewImport(ctx: WorkspaceContext, req: ImportRequest, fetchImpl: Fetch = fetch, now = new Date()): Promise<Preview> {
  requireRole(ctx, "EDITOR", "Importing");
  const data = await loadRows(ctx, req.source, fetchImpl);
  const vc = await validationContext(ctx, now);
  const links = await sheetLinks(ctx, req.type, req.source, data.headers);
  const rows = (await plan(ctx, req.type, data, req.mapping, vc, links)).map((p) => p.preview);
  return { type: req.type, sourceName: data.name, counts: counts(rows), rows };
}

export type RunResult = {
  runId: string;
  sourceId: string;
  sourceName: string;
  /** skipped = invalid rows; deleted = sheet rows whose record was deleted in the app. */
  counts: { created: number; updated: number; unchanged: number; skipped: number; deleted: number };
  errors: { row: number; label: string; reasons: string[] }[];
};

/**
 * Re-validate against current data, then write every valid row in one transaction and
 * skip invalid ones. Saves the mapping, records the run and logs one ActivityEvent.
 */
export async function runImport(
  ctx: WorkspaceContext,
  req: ImportRequest,
  opts: { trigger?: "import" | "sync"; fetchImpl?: Fetch; now?: Date } = {},
): Promise<RunResult> {
  requireRole(ctx, "EDITOR", "Importing");
  const trigger = opts.trigger ?? "import";
  const now = opts.now ?? new Date();
  await purgeExpiredTrash(ctx, now);
  const data = await loadRows(ctx, req.source, opts.fetchImpl ?? fetch);
  const vc = await validationContext(ctx, now);
  const links = await sheetLinks(ctx, req.type, req.source, data.headers);
  const planned = await plan(ctx, req.type, data, req.mapping, vc, links);
  const c = counts(planned.map((p) => p.preview));
  const errors = planned
    .filter((p) => p.preview.kind === "invalid")
    .map((p) => ({ row: p.preview.rowNumber, label: p.preview.label, reasons: p.preview.reasons ?? [] }));
  const actor = ctx.user.name ?? ctx.user.email;
  const db = scopedDb(ctx);
  const plural = RECORDS[req.type].noun.endsWith("s") ? RECORDS[req.type].noun : `${RECORDS[req.type].noun}s`;
  const kindLabel = req.source.kind === "SHEET" ? "Google Sheet" : "CSV";

  try {
    return await db.$transaction(
      async (tx) => {
        // Which record each row is now (new, updated or unchanged), for the next sync.
        const became = new Map<string, string>();
        for (const p of planned) {
          if (p.write) became.set(p.key, (await persistRecord(tx, ctx, req.type, p.write, vc, { logActivity: false })).id);
          else if (p.matchedId) became.set(p.key, p.matchedId);
        }

        const sourceKey = sourceKeyFor(req.source, data.headers);
        const sheet = req.source.kind === "SHEET" ? req.source : null;
        const source = await tx.importSource.upsert({
          where: { workspaceId_entityType_sourceKey: { workspaceId: ctx.workspace.id, entityType: req.type, sourceKey } },
          create: {
            workspaceId: ctx.workspace.id, entityType: req.type, kind: req.source.kind, sourceKey, name: data.name,
            spreadsheetId: sheet?.spreadsheetId, sheetId: sheet?.sheetId, sheetTitle: data.sheetTitle,
            headerSignature: headerSignature(data.headers), mapping: req.mapping, createdById: ctx.user.id,
            lastSyncedAt: sheet ? now : null,
          },
          update: {
            name: data.name, sheetTitle: data.sheetTitle, headerSignature: headerSignature(data.headers), mapping: req.mapping,
            ...(sheet ? { lastSyncedAt: now } : {}),
          },
        });
        const run = await tx.importRun.create({
          data: {
            workspaceId: ctx.workspace.id, sourceId: source.id, entityType: req.type, trigger, sourceName: data.name, actorName: actor,
            created: c.new, updated: c.update, unchanged: c.unchanged, skipped: c.invalid, deleted: c.deleted,
            errors: errors.slice(0, MAX_STORED_ERRORS), createdAt: now,
          },
        });
        if (sheet && became.size) {
          const keys = [...became.keys()];
          await tx.importLink.deleteMany({ where: { sourceId: source.id, matchKey: { in: keys } } });
          await tx.importLink.createMany({
            data: keys.map((matchKey) => ({ workspaceId: ctx.workspace.id, sourceId: source.id, matchKey, recordId: became.get(matchKey)! })),
          });
        }
        const parts = [
          `${c.new} new`, `${c.update} updated`, ...(c.unchanged ? [`${c.unchanged} unchanged`] : []), `${c.invalid} skipped`,
          ...(c.deleted ? [`${c.deleted} deleted in the app, not re-imported`] : []),
        ];
        await tx.activityEvent.create({
          data: {
            workspaceId: ctx.workspace.id, entityType: "Import", entityId: run.id, action: trigger === "sync" ? "synced" : "imported",
            summary: `${actor} ${trigger === "sync" ? "synced" : "imported"} ${plural} from "${data.name}" (${kindLabel}): ${parts.join(", ")}`,
            actorName: actor, createdAt: now,
          },
        });
        return {
          runId: run.id, sourceId: source.id, sourceName: data.name,
          counts: { created: c.new, updated: c.update, unchanged: c.unchanged, skipped: c.invalid, deleted: c.deleted }, errors,
        };
      },
      { timeout: 120_000 },
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw new ImportError("Someone saved a record with the same code or email during the import. Nothing was imported; preview again.");
    throw e;
  }
}

export type SourceSummary = {
  id: string;
  type: ImportType;
  kind: "CSV" | "SHEET";
  name: string;
  lastSyncedAt: Date | null;
  updatedAt: Date;
  lastRun: { at: Date; trigger: string; actor: string; created: number; updated: number; unchanged: number; skipped: number; deleted: number } | null;
};

export async function listImportSources(ctx: WorkspaceContext): Promise<SourceSummary[]> {
  const sources = await scopedDb(ctx).importSource.findMany({
    orderBy: { updatedAt: "desc" },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return sources.map((s) => {
    const r = s.runs[0];
    return {
      id: s.id, type: s.entityType as ImportType, kind: s.kind, name: s.name, lastSyncedAt: s.lastSyncedAt, updatedAt: s.updatedAt,
      lastRun: r ? { at: r.createdAt, trigger: r.trigger, actor: r.actorName, created: r.created, updated: r.updated, unchanged: r.unchanged, skipped: r.skipped, deleted: r.deleted } : null,
    };
  });
}

/** A saved source, for "Import again" / "Edit mapping". */
export async function getImportSource(ctx: WorkspaceContext, id: string) {
  const s = await scopedDb(ctx).importSource.findUnique({ where: { id } });
  if (!s) throw new ImportError("That import source doesn't exist in this workspace.");
  return s;
}

/**
 * One-way sync, sheet to app, with the clicking user's own Google access. Stops (and asks
 * for a re-map) if the sheet's columns changed. Never deletes records missing from the sheet,
 * and skips rows whose record was deleted in the app since an earlier sync.
 */
export async function syncImportSource(ctx: WorkspaceContext, sourceId: string, fetchImpl: Fetch = fetch, now = new Date()): Promise<RunResult> {
  requireRole(ctx, "EDITOR", "Syncing");
  const s = await getImportSource(ctx, sourceId);
  if (s.kind !== "SHEET" || !s.spreadsheetId || s.sheetId == null) throw new ImportError("Only Google Sheet sources can be synced.");
  const source: ImportSourceInput = { kind: "SHEET", spreadsheetId: s.spreadsheetId, sheetId: s.sheetId };
  const data = await loadRows(ctx, source, fetchImpl);
  if (headerSignature(data.headers) !== s.headerSignature) {
    throw new ImportError(`The columns in "${s.name}" changed since the last import. Open it to update the mapping, then sync again.`);
  }
  return runImport(ctx, { type: s.entityType as ImportType, source, mapping: s.mapping as Mapping }, { trigger: "sync", fetchImpl, now });
}

