"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, FileSpreadsheet, FileUp, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { useShell } from "@/components/shell/shell-context";
import { cn } from "@/lib/utils";
import type { ImportSourceInput, MappingHelp, Preview, PreviewRow, RunResult } from "@/lib/data/imports";
import type { SheetTab } from "@/lib/google/sheets";
import { IMPORT_TYPES, importFields, mappingProblems, requiredMappedFields, type ImportType, type Mapping } from "@/lib/import/mapping";
import { MAX_CSV_BYTES, parseCsv } from "@/lib/import/parse";
import { sectionById } from "@/lib/nav";
import { RECORD_SECTION, RECORDS } from "@/lib/records/registry";
import {
  grantSheetsAccessAction, openSheetAction, prepareMappingAction, previewImportAction, runImportAction,
} from "./actions";

export type WizardStart = {
  type: ImportType;
  saved?: { id: string; name: string; kind: "CSV" | "SHEET"; source: ImportSourceInput | null; mapping: Mapping };
  sheetLink?: string;
  /** Work the server already did for this start (see page.tsx), so the wizard opens on the right step. */
  sheet?: { spreadsheetId: string; title: string; tabs: SheetTab[]; sheetId: number | null };
  help?: MappingHelp;
  preview?: Preview;
  error?: { message: string; code?: string };
};

type Step = "source" | "map" | "preview" | "done";
type Csv = { name: string; headers: string[]; rows: string[][] };
type Sheet = { spreadsheetId: string; title: string; tabs: SheetTab[]; sheetId: number | null };

const MAX_ROWS = 2000;
const PREVIEW_LIMIT = 300;
const plural = (t: ImportType) => (RECORDS[t].noun.endsWith("s") ? RECORDS[t].noun : `${RECORDS[t].noun}s`);
const selectClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** The saved mapping when the columns match; otherwise what still applies from it, else exact header matches. */
function initialMapping(h: MappingHelp): Mapping {
  if (h.saved && h.savedMatches) return h.saved;
  return Object.fromEntries(h.headers.map((c) => [c, h.saved && c in h.saved ? h.saved[c] : h.exact[c]]));
}

function StepDots({ step }: { step: Step }) {
  const steps: [Step, string][] = [["source", "Source"], ["map", "Map columns"], ["preview", "Preview"], ["done", "Import"]];
  const at = steps.findIndex(([s]) => s === step);
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {steps.map(([s, label], i) => (
        <li key={s} className={cn("flex items-center gap-1.5", i === at ? "font-medium text-foreground" : "text-muted-foreground")}>
          <span className={cn("flex size-4 items-center justify-center rounded-full border text-[10px] tabular-nums", i < at && "border-emerald-500/40 text-emerald-400")}>
            {i < at ? <Check className="size-2.5" /> : i + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function ImportWizard({ start, sheetsGranted }: { start: WizardStart; sheetsGranted: boolean }) {
  const router = useRouter();
  const { invalidateSearch } = useShell();
  const [type, setType] = useState<ImportType>(start.type);
  const [step, setStep] = useState<Step>(start.preview ? "preview" : start.help ? "map" : "source");
  const [kind, setKind] = useState<"CSV" | "SHEET">(start.saved?.kind ?? (start.sheetLink ? "SHEET" : "CSV"));
  const [csv, setCsv] = useState<Csv | null>(null);
  const [link, setLink] = useState(start.sheetLink ?? "");
  const [sheet, setSheet] = useState<Sheet | null>(
    start.sheet ??
      (start.saved?.source?.kind === "SHEET" ? { spreadsheetId: start.saved.source.spreadsheetId, title: start.saved.name, tabs: [], sheetId: start.saved.source.sheetId } : null),
  );
  const [help, setHelp] = useState<MappingHelp | null>(start.help ?? null);
  const [mapping, setMapping] = useState<Mapping>(() => (start.help ? initialMapping(start.help) : {}));
  const [usingSaved, setUsingSaved] = useState(!!start.preview);
  const [preview, setPreview] = useState<Preview | null>(start.preview ?? null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(start.error ?? null);
  const [busy, startBusy] = useTransition();
  const [busyLabel, setBusyLabel] = useState("");

  const source = (): ImportSourceInput | null =>
    kind === "CSV" ? (csv ? { kind: "CSV", ...csv } : null) : sheet && sheet.sheetId != null ? { kind: "SHEET", spreadsheetId: sheet.spreadsheetId, sheetId: sheet.sheetId } : null;

  const run = (label: string, fn: () => Promise<void>) => {
    setError(null);
    setBusyLabel(label);
    startBusy(fn);
  };

  const doPreview = (m: Mapping, src = source()) =>
    run("Checking every row…", async () => {
      if (!src) return;
      const r = await previewImportAction({ type, source: src, mapping: m });
      if (!r.ok) return setError({ message: r.error, code: r.code });
      setPreview(r.preview);
      setStep("preview");
    });

  const toMapping = (src = source()) =>
    run("Reading columns…", async () => {
      if (!src) return;
      const r = await prepareMappingAction(type, src);
      if (!r.ok) return setError({ message: r.error, code: r.code });
      const h = r.help;
      setHelp(h);
      if (h.saved && h.savedMatches) {
        // Same columns as last time: skip straight to the preview.
        setMapping(h.saved);
        setUsingSaved(true);
        const pr = await previewImportAction({ type, source: src, mapping: h.saved });
        if (!pr.ok) return setError({ message: pr.error, code: pr.code });
        setPreview(pr.preview);
        setStep("preview");
        return;
      }
      setMapping(initialMapping(h));
      setUsingSaved(false);
      setStep("map");
    });

  const openSheet = (l = link) =>
    run("Opening the sheet…", async () => {
      const r = await openSheetAction(l);
      if (!r.ok) return setError({ message: r.error, code: r.code });
      setSheet({ spreadsheetId: r.spreadsheetId, title: r.title, tabs: r.tabs, sheetId: r.sheetId });
    });

  const onFile = async (file: File | undefined) => {
    setError(null);
    setCsv(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) return setError({ message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB.` });
    const parsed = parseCsv(await file.text());
    if (parsed.headers.length === 0 || parsed.rows.length === 0) return setError({ message: "That file has no header row or no data rows." });
    if (parsed.rows.length > MAX_ROWS) return setError({ message: `That file has ${parsed.rows.length} rows; the limit is ${MAX_ROWS}.` });
    setCsv({ name: file.name, ...parsed });
  };

  const doImport = () =>
    run("Importing…", async () => {
      const src = source();
      if (!src) return;
      const r = await runImportAction({ type, source: src, mapping });
      if (!r.ok) return setError({ message: r.error, code: r.code });
      setResult(r.result);
      setStep("done");
      invalidateSearch();
      router.refresh();
    });

  const reset = () => {
    setStep("source");
    setCsv(null);
    setSheet(null);
    setLink("");
    setHelp(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const grantReturn = `/import?type=${type}${link ? `&sheet=${encodeURIComponent(link)}` : ""}`;

  return (
    <section className="rounded-md border" aria-label="New import">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-medium">New import</h3>
        <StepDots step={step} />
        {busy && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {busyLabel}
          </span>
        )}
      </div>

      <div className="space-y-4 p-4">
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            <span className="flex-1">{error.message}</span>
            {error.code === "needs-grant" && (
              <form action={grantSheetsAccessAction.bind(null, grantReturn)}>
                <Button size="sm" type="submit">Grant Sheets access</Button>
              </form>
            )}
          </div>
        )}

        {step === "source" && (
          <>
            <div className="space-y-1.5">
              <p className="text-xs font-medium">What are you importing?</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Record type">
                {IMPORT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={type === t}
                    onClick={() => setType(t)}
                    className={cn("rounded-md border px-2.5 py-1 text-sm capitalize", type === t ? "border-foreground/40 bg-muted" : "text-muted-foreground hover:bg-muted/50")}
                  >
                    {plural(t)}
                  </button>
                ))}
              </div>
            </div>

            {start.saved?.kind === "CSV" && (
              <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                Upload the new version of <span className="text-foreground">{start.saved.name}</span>. If its columns are the same, the saved mapping is used and you go straight to the preview.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setKind("CSV")}
                className={cn("flex gap-3 rounded-md border px-3 py-3 text-left", kind === "CSV" ? "border-foreground/40 bg-muted" : "hover:bg-muted/50")}
              >
                <FileUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">Upload a CSV</span>
                  <span className="block text-xs text-muted-foreground">Up to 2 MB and {MAX_ROWS.toLocaleString()} rows. First row is the header.</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setKind("SHEET")}
                className={cn("flex gap-3 rounded-md border px-3 py-3 text-left", kind === "SHEET" ? "border-foreground/40 bg-muted" : "hover:bg-muted/50")}
              >
                <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">Google Sheet</span>
                  <span className="block text-xs text-muted-foreground">Paste a link. Read-only, with your own Google access. Link it once, then Sync now.</span>
                </span>
              </button>
            </div>

            {kind === "CSV" ? (
              <div className="space-y-1.5">
                <label htmlFor="csv-file" className="text-xs font-medium">CSV file</label>
                <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
                {csv && (
                  <p className="text-xs text-muted-foreground">
                    {csv.name}: {csv.rows.length.toLocaleString()} rows, {csv.headers.length} columns ({csv.headers.slice(0, 6).join(", ")}{csv.headers.length > 6 ? ", …" : ""})
                  </p>
                )}
              </div>
            ) : !sheetsGranted ? (
              <div className="space-y-2 rounded-md border px-3 py-3">
                <p className="text-sm">Reading Google Sheets needs one extra, read-only permission on your Google account.</p>
                <p className="text-xs text-muted-foreground">
                  Only you grant it, only for this; the app can read spreadsheets you can open, never change them. Revoke any time in your Google account settings.
                </p>
                <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Optional: paste the sheet link now" aria-label="Google Sheets link" />
                <form action={grantSheetsAccessAction.bind(null, grantReturn)}>
                  <Button size="sm" type="submit">Grant read-only Sheets access</Button>
                </form>
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="sheet-link" className="text-xs font-medium">Google Sheets link</label>
                <div className="flex gap-2">
                  <Input
                    id="sheet-link"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), openSheet())}
                  />
                  <Button size="sm" variant="outline" disabled={!link.trim() || busy} onClick={() => openSheet()}>Open</Button>
                </div>
                {sheet && sheet.tabs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{sheet.title}</span>
                    <select
                      aria-label="Tab"
                      className={cn(selectClass, "w-auto")}
                      value={sheet.sheetId ?? ""}
                      onChange={(e) => setSheet({ ...sheet, sheetId: Number(e.target.value) })}
                    >
                      {sheet.tabs.map((t) => <option key={t.sheetId} value={t.sheetId}>{t.title}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <Button size="sm" disabled={!source() || busy} onClick={() => toMapping()}>
                Continue
              </Button>
            </div>
          </>
        )}

        {step === "map" && help && (
          <MapStep
            type={type}
            help={help}
            mapping={mapping}
            setMapping={setMapping}
            busy={busy}
            onBack={() => setStep("source")}
            onPreview={() => doPreview(mapping)}
          />
        )}

        {step === "preview" && preview && (
          <PreviewStep
            preview={preview}
            usingSaved={usingSaved}
            busy={busy}
            onEditMapping={() => {
              if (help) setMapping(mapping);
              setStep("map");
            }}
            onImport={doImport}
          />
        )}

        {step === "done" && result && <DoneStep type={type} result={result} onAnother={reset} />}
      </div>
    </section>
  );
}

// ---------- Step 2: mapping ----------

function MapStep({
  type, help, mapping, setMapping, busy, onBack, onPreview,
}: {
  type: ImportType;
  help: MappingHelp;
  mapping: Mapping;
  setMapping: (m: Mapping) => void;
  busy: boolean;
  onBack: () => void;
  onPreview: () => void;
}) {
  const fields = importFields(type);
  const [evidence, setEvidence] = useState<string | null>(null);
  const problems = mappingProblems(type, mapping);
  const mappedFields = new Set(Object.values(mapping).filter(Boolean));
  const matchFields = requiredMappedFields(type);
  const unmappedRequired = fields.filter((f) => f.required && !mappedFields.has(f.name) && !matchFields.includes(f.name));
  // A suggestion is offered only if it changes something and its field isn't taken by another column.
  const pending = (help.ai?.suggestions ?? []).filter(
    (s) => mapping[s.header] !== s.field && !Object.entries(mapping).some(([c, f]) => f === s.field && c !== s.header),
  );
  const accept = (items: typeof pending) => {
    const next = { ...mapping };
    for (const s of items) next[s.header] = s.field;
    setMapping(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">
          Map the columns of <span className="font-medium">{help.sourceName}</span> to {RECORDS[type].noun} fields.
        </p>
        {help.saved && !help.savedMatches && (
          <StatusBadge status="attention">Columns changed since the saved mapping</StatusBadge>
        )}
        {help.ai && pending.length > 0 && (
          <Button size="xs" variant="outline" className="ml-auto border-violet-500/30 text-violet-400" onClick={() => accept(pending)}>
            <Sparkles /> Accept {pending.length} AI suggestion{pending.length === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">Column</th>
              <th className="px-3 py-2 text-left font-medium">Sample values</th>
              <th className="w-64 px-3 py-2 text-left font-medium">Imports into</th>
            </tr>
          </thead>
          <tbody>
            {help.headers.map((h) => {
              const s = pending.find((x) => x.header === h);
              const field = fields.find((f) => f.name === s?.field);
              return (
                <tr key={h} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2 font-medium">{h}</td>
                  <td className="max-w-72 px-3 py-2 text-xs text-muted-foreground">
                    <span className="line-clamp-2">{help.samples[h]?.join(" · ") || "—"}</span>
                  </td>
                  <td className="space-y-1.5 px-3 py-2">
                    <select
                      aria-label={`Field for column ${h}`}
                      className={selectClass}
                      value={mapping[h] ?? ""}
                      onChange={(e) => setMapping({ ...mapping, [h]: e.target.value || null })}
                    >
                      <option value="">Ignore this column</option>
                      {fields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label}{matchFields.includes(f.name) ? " (match key)" : f.required ? " *" : ""}
                        </option>
                      ))}
                    </select>
                    {s && field && (
                      <div className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="flex shrink-0 items-center gap-1 font-medium whitespace-nowrap text-violet-400"><Sparkles className="size-3" /> AI Insight</span>
                          <span className="text-foreground">{field.label}</span>
                          <span className="text-muted-foreground tabular-nums">{Math.round(s.confidence * 100)}%</span>
                          <button type="button" className="ml-auto text-violet-400 hover:underline" onClick={() => accept([s])}>Accept</button>
                        </div>
                        <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setEvidence(evidence === h ? null : h)}>
                          {evidence === h ? "Hide evidence" : "View evidence"}
                        </button>
                        {evidence === h && (
                          <p className="mt-1 text-muted-foreground">
                            {s.reason} Samples: {help.samples[h]?.map((x) => `"${x}"`).join(", ") || "none"}. Suggested by {help.ai?.provider}; check before accepting.
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!help.ai && (
        <p className="text-xs text-muted-foreground">{help.aiNote ?? "AI suggestions aren't available; map columns by hand."}</p>
      )}
      {problems.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-400">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {unmappedRequired.length > 0 && problems.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Not mapped: {unmappedRequired.map((f) => f.label).join(", ")}. Updates keep existing values; new rows use the Add form&apos;s default or show as invalid.
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft /> Source</Button>
        <Button size="sm" disabled={problems.length > 0 || busy} onClick={onPreview}>Preview rows</Button>
      </div>
    </div>
  );
}

// ---------- Step 3: preview ----------

const KIND: Record<PreviewRow["kind"], { label: string; status?: "healthy" | "info" | "critical" }> = {
  new: { label: "New", status: "healthy" },
  update: { label: "Updated", status: "info" },
  unchanged: { label: "Unchanged" },
  invalid: { label: "Invalid", status: "critical" },
};

function PreviewStep({
  preview, usingSaved, busy, onEditMapping, onImport,
}: {
  preview: Preview;
  usingSaved: boolean;
  busy: boolean;
  onEditMapping: () => void;
  onImport: () => void;
}) {
  const [tab, setTab] = useState<PreviewRow["kind"] | "all">(preview.counts.invalid > 0 ? "invalid" : "all");
  const rows = preview.rows.filter((r) => tab === "all" || r.kind === tab);
  const writes = preview.counts.new + preview.counts.update;
  const noun = plural(preview.type);

  return (
    <div className="space-y-3">
      {usingSaved && (
        <p className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
          <Check className="size-4 text-emerald-400" /> Same columns as last time: using the saved mapping.
          <button type="button" className="ml-auto text-xs text-foreground underline-offset-2 hover:underline" onClick={onEditMapping}>Edit mapping</button>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Rows">
        {(["all", "new", "update", "unchanged", "invalid"] as const).map((k) => {
          const n = k === "all" ? preview.rows.length : preview.counts[k];
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn("rounded-md border px-2.5 py-1 text-xs tabular-nums", tab === k ? "border-foreground/40 bg-muted text-foreground" : "text-muted-foreground")}
            >
              {k === "all" ? "All" : KIND[k].label} · {n}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-muted-foreground">{preview.sourceName}</span>
      </div>

      <div className="max-h-[28rem] overflow-y-auto rounded-md border">
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No rows here.</p>
        ) : (
          <ul className="divide-y">
            {rows.slice(0, PREVIEW_LIMIT).map((r) => (
              <li key={r.rowNumber} className="flex gap-3 px-3 py-2 text-sm">
                <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">Row {r.rowNumber}</span>
                <span className="w-20 shrink-0">
                  {KIND[r.kind].status ? <StatusBadge status={KIND[r.kind].status!}>{KIND[r.kind].label}</StatusBadge> : <span className="text-xs text-muted-foreground">{KIND[r.kind].label}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.label}</p>
                  {r.changes && (
                    <p className="text-xs text-muted-foreground">
                      {r.changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(" · ")}
                    </p>
                  )}
                  {r.reasons && (
                    <ul className="text-xs text-red-400">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {rows.length > PREVIEW_LIMIT && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing {PREVIEW_LIMIT} of {rows.length}.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onEditMapping}><ArrowLeft /> Mapping</Button>
        <p className="ml-auto text-xs text-muted-foreground">
          {preview.counts.invalid > 0 && `${preview.counts.invalid} invalid row${preview.counts.invalid === 1 ? "" : "s"} will be skipped. `}
          Nothing is deleted.
        </p>
        <Button size="sm" disabled={busy || writes === 0} onClick={onImport}>
          {writes === 0
            ? "Nothing to import"
            : `Import: ${[preview.counts.new && `${preview.counts.new} new`, preview.counts.update && `${preview.counts.update} updated`].filter(Boolean).join(", ")} ${noun}`}
        </Button>
      </div>
    </div>
  );
}

// ---------- Step 4: result ----------

function DoneStep({ type, result, onAnother }: { type: ImportType; result: RunResult; onAnother: () => void }) {
  const c = result.counts;
  const section = sectionById(RECORD_SECTION[type]);
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm">
        <Check className="size-4 text-emerald-400" />
        Imported from <span className="font-medium">{result.sourceName}</span>: {c.created} new, {c.updated} updated
        {c.unchanged ? `, ${c.unchanged} unchanged` : ""}, {c.skipped} skipped. Logged to What changed; the mapping is saved.
      </p>
      {result.errors.length > 0 && (
        <details className="rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-red-400">{result.errors.length} skipped row{result.errors.length === 1 ? "" : "s"}</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {result.errors.slice(0, 50).map((e) => (
              <li key={e.row}><span className="text-muted-foreground">Row {e.row} · {e.label}:</span> {e.reasons.join(" ")}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" render={<Link href={section.href} />}>View {plural(type)}</Button>
        <Button size="sm" variant="ghost" onClick={onAnother}><X /> New import</Button>
      </div>
    </div>
  );
}
