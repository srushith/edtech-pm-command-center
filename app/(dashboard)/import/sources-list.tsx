"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, FileText, Loader2, RefreshCw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { useShell } from "@/components/shell/shell-context";
import type { RunResult, SourceSummary } from "@/lib/data/imports";
import { RECORDS } from "@/lib/records/registry";
import { grantSheetsAccessAction, syncSourceAction } from "./actions";

const when = (d: Date) => new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC";

function SourceRow({ s }: { s: SourceSummary }) {
  const router = useRouter();
  const { invalidateSearch } = useShell();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<{ result?: RunResult; error?: string; code?: string } | null>(null);
  const sync = () =>
    start(async () => {
      const r = await syncSourceAction(s.id);
      if (r.ok) {
        setOutcome({ result: r.result });
        invalidateSearch();
        router.refresh();
      } else setOutcome({ error: r.error, code: r.code });
    });
  const Icon = s.kind === "SHEET" ? FileSpreadsheet : FileText;
  const run = s.lastRun;

  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{s.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {RECORDS[s.type].noun} · {s.kind === "SHEET" ? "Google Sheet, one-way sync" : "CSV"}
            {run && ` · last ${run.trigger === "sync" ? "sync" : "import"} ${when(run.at)} by ${run.actor}: ${run.created} new, ${run.updated} updated, ${run.skipped} skipped${run.deleted ? `, ${run.deleted} deleted in app` : ""}`}
          </p>
        </div>
        {s.kind === "SHEET" && (
          <Button size="xs" variant="outline" disabled={pending} onClick={sync}>
            {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
          </Button>
        )}
        <ButtonLink size="xs" variant="ghost" href={`/import?source=${s.id}`}>
          {s.kind === "SHEET" ? "Review & import" : "Import new version"}
        </ButtonLink>
      </div>
      {outcome?.result && (
        <p role="status" className="text-xs text-emerald-400">
          Synced: {outcome.result.counts.created} new, {outcome.result.counts.updated} updated, {outcome.result.counts.unchanged} unchanged, {outcome.result.counts.skipped} skipped
          {outcome.result.counts.deleted ? `, ${outcome.result.counts.deleted} deleted in the app (not re-imported)` : ""}.
          {outcome.result.errors.length > 0 && (
            <span className="text-muted-foreground"> First skipped: row {outcome.result.errors[0].row}, {outcome.result.errors[0].reasons[0]}</span>
          )}
        </p>
      )}
      {outcome?.error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-red-400">
          <span>{outcome.error}</span>
          {outcome.code === "needs-grant" && (
            <form action={grantSheetsAccessAction.bind(null, "/import")}>
              <Button size="xs" type="submit">Grant Sheets access</Button>
            </form>
          )}
          {/columns .* changed/.test(outcome.error) && (
            <Link className="text-foreground underline-offset-2 hover:underline" href={`/import?source=${s.id}`}>Update mapping</Link>
          )}
        </div>
      )}
    </li>
  );
}

/** Saved imports: linked sheets (Sync now) and remembered CSV layouts. */
export function SourcesList({ sources }: { sources: SourceSummary[] }) {
  return (
    <section className="space-y-2" aria-labelledby="sources-heading">
      <h3 id="sources-heading" className="text-sm font-medium">
        Saved imports <span className="font-normal text-muted-foreground">· {sources.length}</span>
      </h3>
      {sources.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Each import saves its column mapping here. Linked Google Sheets get a Sync now button.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">{sources.map((s) => <SourceRow key={s.id} s={s} />)}</ul>
      )}
    </section>
  );
}
