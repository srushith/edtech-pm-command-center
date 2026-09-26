"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useShell } from "@/components/shell/shell-context";
import type { TrashItem } from "@/lib/data/trash";
import { deleteForeverAction, emptyTrashAction, restoreFromTrashAction, type ActionResult } from "../actions";

const EMPTY_PHRASE = "empty trash";
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const when = (d: Date) => new Date(d).toISOString().slice(0, 16).replace("T", " ");

function Feedback({ result }: { result: ActionResult }) {
  if (result.error) return <p role="alert" className="text-xs text-red-400">{result.error}</p>;
  if (result.message) return <p role="status" className="text-xs text-emerald-400">{result.message}</p>;
  return null;
}

/** Runs a server action, then refreshes the page and ⌘K (restored records are searchable again). */
function useTrashAction() {
  const router = useRouter();
  const { invalidateSearch } = useShell();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>({});
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (!r.error) {
        invalidateSearch();
        router.refresh();
      }
    });
  return { pending, result, run };
}

function TrashRow({ item }: { item: TrashItem }) {
  const { pending, result, run } = useTrashAction();
  const [confirming, setConfirming] = useState(false);
  const { daysLeft } = item;
  return (
    <li className="space-y-1 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{capitalize(item.label)}</p>
          <p className="text-xs text-muted-foreground">
            {item.contents.length > 0 && <>with {item.contents.map((c) => `${c.count} ${c.label}`).join(", ")} · </>}
            deleted by {item.deletedBy} · {when(item.deletedAt)} UTC ·{" "}
            <span className={daysLeft <= 3 ? "text-amber-400" : undefined}>{daysLeft === 0 ? "deleted for good today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}</span>
          </p>
        </div>
        {pending && <Loader2 className="mt-0.5 size-3.5 animate-spin text-muted-foreground" />}
        {confirming ? (
          <span className="flex items-center gap-1">
            <Button size="xs" variant="destructive" disabled={pending} onClick={() => run(() => deleteForeverAction(item.id))}>Delete forever</Button>
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => restoreFromTrashAction(item.id))}>
              <RotateCcw /> Restore
            </Button>
            <Button size="icon-xs" variant="ghost" disabled={pending} aria-label={`Delete ${item.label} forever`} title="Delete forever" onClick={() => setConfirming(true)}>
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
      <Feedback result={result} />
    </li>
  );
}

export function TrashList({ items }: { items: TrashItem[] }) {
  const { pending, result, run } = useTrashAction();
  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState(false);

  if (items.length === 0) {
    return (
      <div className="space-y-1">
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Trash is empty.</p>
        <Feedback result={result} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-md border px-3">
        {items.map((i) => <TrashRow key={i.id} item={i} />)}
      </ul>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="text-sm text-red-400">
            Permanently delete all {items.length} item{items.length === 1 ? "" : "s"}? Type <span className="font-mono">{EMPTY_PHRASE}</span>:
          </p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} className="h-7 w-36" aria-label={`Type ${EMPTY_PHRASE} to confirm`} autoFocus />
          <Button size="sm" variant="destructive" disabled={pending || typed.trim().toLowerCase() !== EMPTY_PHRASE} onClick={() => run(emptyTrashAction)}>
            {pending && <Loader2 className="animate-spin" />} Empty Trash
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          <Trash2 /> Empty Trash
        </Button>
      )}
      <Feedback result={result} />
    </div>
  );
}
