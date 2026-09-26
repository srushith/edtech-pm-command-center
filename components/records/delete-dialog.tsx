"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Trash2, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useShell } from "@/components/shell/shell-context";
import { RECORDS } from "@/lib/records/registry";
import { ENTITY_LABELS } from "@/lib/search-types";
import type { DeletePreview } from "@/lib/data/trash";
import {
  deleteRecordsAction,
  markInstructorsInactiveAction,
  previewDeleteAction,
  undoDeleteAction,
} from "@/app/(dashboard)/records/actions";

const UNDO_TOAST_MS = 10_000;
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

type Toast =
  | { kind: "deleted"; batchId: string; label: string }
  | { kind: "message"; text: string; error?: boolean };

/**
 * The one delete flow, opened by requestDelete() from tables, the edit sheet and ⌘K results:
 * preview what else goes (typed confirmation when anything does), move to Trash, then an
 * Undo toast. Instructors with sessions are blocked, with "Mark inactive" offered instead.
 */
export function DeleteDialog() {
  const router = useRouter();
  const { deleteRequest: req, requestDelete, closeDeleteRequest, recordForm, closeRecordForm, invalidateSearch } = useShell();
  const [loaded, setLoaded] = useState<{ key: string; preview?: DeletePreview; error?: string } | null>(null);
  // Typed confirmation and errors belong to one request: a new request starts clean.
  const [typedFor, setTypedFor] = useState({ key: "", value: "" });
  const [errorFor, setErrorFor] = useState({ key: "", value: null as string | null });
  const [busy, startBusy] = useTransition();
  const [, startLoading] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);

  const key = req ? `${req.type}:${req.ids.join(",")}` : null;
  useEffect(() => {
    if (!req || !key) return;
    startLoading(async () => {
      const r = await previewDeleteAction(req.type, req.ids);
      setLoaded(r.ok ? { key, preview: r.preview } : { key, error: r.error });
    });
  }, [req, key]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.kind === "deleted" ? UNDO_TOAST_MS : 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const ready = loaded && loaded.key === key ? loaded : null;
  const typed = typedFor.key === key ? typedFor.value : "";
  const setTyped = (value: string) => setTypedFor({ key: key ?? "", value });
  const error = errorFor.key === key ? errorFor.value : null;
  const setError = (value: string | null) => setErrorFor({ key: key ?? "", value });
  const p = ready?.preview;
  const def = req ? RECORDS[req.type] : null;
  const many = (req?.ids.length ?? 0) > 1;
  const title = !req || !def ? "" : many ? `Delete ${req.ids.length} ${ENTITY_LABELS[req.type].toLowerCase()}?` : `Delete ${def.noun}${p ? ` ${p.labels[0]}` : ""}?`;
  const confirmOk = !p?.confirmText || norm(typed) === norm(p.confirmText);
  const blockedIds = new Set(p?.blocked.map((b) => b.id));
  const deletable = p ? p.ids.filter((id) => !blockedIds.has(id)) : [];

  const refresh = () => {
    invalidateSearch();
    router.refresh();
  };

  const confirm = () => {
    if (!req || !p || !confirmOk) return;
    startBusy(async () => {
      const r = await deleteRecordsAction(req.type, p.ids, p.confirmText ? typed : null);
      if (!r.ok) return setError(r.error);
      if (recordForm && recordForm.type === req.type && recordForm.id && p.ids.includes(recordForm.id)) closeRecordForm();
      req.onDeleted?.();
      closeDeleteRequest();
      setToast({ kind: "deleted", batchId: r.batchId, label: r.label });
      refresh();
    });
  };

  const markInactive = () => {
    if (!p) return;
    startBusy(async () => {
      const r = await markInstructorsInactiveAction(p.blocked.map((b) => b.id));
      if (!r.ok) return setError(r.error);
      closeDeleteRequest();
      setToast({ kind: "message", text: `Marked ${p.blocked.length === 1 ? p.blocked[0].label : `${p.blocked.length} instructors`} inactive. Their sessions and ratings stay.` });
      refresh();
    });
  };

  const undo = (batchId: string) => {
    startBusy(async () => {
      const r = await undoDeleteAction(batchId);
      setToast(r.ok ? { kind: "message", text: `Restored ${r.label}.` } : { kind: "message", text: r.error, error: true });
      if (r.ok) refresh();
    });
  };

  return (
    <>
      <Dialog open={!!req} onOpenChange={(open) => !open && !busy && closeDeleteRequest()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="leading-snug">{title}</DialogTitle>
            <DialogDescription>
              {p && p.blocked.length === 0 && "It moves to Trash. Owners can restore it for 30 days; after that it's deleted for good."}
            </DialogDescription>
          </DialogHeader>

          {!ready ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking what else this affects…</p>
          ) : ready.error ? (
            <p role="alert" className="text-sm text-red-400">{ready.error}</p>
          ) : p && p.blocked.length > 0 ? (
            <div className="space-y-2 text-sm">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="font-medium text-amber-400">
                  {p.blocked.length === 1 ? "This instructor can't be deleted" : `${p.blocked.length} of these instructors can't be deleted`}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {p.blocked.slice(0, 5).map((b) => <li key={b.id}>{b.label} {b.reason}.</li>)}
                  {p.blocked.length > 5 && <li>and {p.blocked.length - 5} more.</li>}
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                Deleting them would take their sessions, ratings and learner feedback with them. Mark them inactive instead: their history stays,
                and they&apos;re no longer offered for new sessions. You can make them active again by editing them.
              </p>
            </div>
          ) : p ? (
            <div className="space-y-3 text-sm">
              {many && (
                <p className="line-clamp-2 text-xs text-muted-foreground">{p.labels.slice(0, 6).join(" · ")}{p.labels.length > 6 && ` · +${p.labels.length - 6} more`}</p>
              )}
              {p.removes.length > 0 && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
                  <p className="text-xs font-medium text-red-400">Also moves to Trash</p>
                  <ul className="mt-1 grid grid-cols-2 gap-x-4 text-xs">
                    {p.removes.map((r) => <li key={r.label}><span className="font-semibold tabular-nums">{r.count}</span> {r.label}</li>)}
                  </ul>
                </div>
              )}
              {p.unlinks.length > 0 && (
                <div className="rounded-md border px-3 py-2">
                  <p className="text-xs font-medium">Stays, but loses a link (back if restored)</p>
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {p.unlinks.map((u) => <li key={u.label}><span className="tabular-nums text-foreground">{u.count}</span> {u.label}</li>)}
                  </ul>
                </div>
              )}
              {p.confirmText && (
                <label className="block space-y-1.5">
                  <span className="text-xs text-muted-foreground">
                    Type <span className="font-mono text-foreground">{p.confirmText}</span> to confirm{many ? " (the number of records)" : ""}
                  </span>
                  <Input
                    autoFocus
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && confirm()}
                    aria-label={`Type ${p.confirmText} to confirm`}
                    autoComplete="off"
                  />
                </label>
              )}
            </div>
          ) : null}

          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

          <DialogFooter>
            <Button variant="ghost" size="sm" disabled={busy} onClick={closeDeleteRequest}>Cancel</Button>
            {p && p.blocked.length > 0 ? (
              <>
                {deletable.length > 0 && req && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => requestDelete({ ...req, ids: deletable })}>
                    Delete the other {deletable.length}
                  </Button>
                )}
                <Button size="sm" disabled={busy} onClick={markInactive}>
                  {busy ? <Loader2 className="animate-spin" /> : <UserX />}
                  Mark {p.blocked.length === 1 ? "inactive" : `${p.blocked.length} inactive`}
                </Button>
              </>
            ) : (
              <Button variant="destructive" size="sm" disabled={!p || busy || !confirmOk} onClick={confirm} autoFocus={!p?.confirmText}>
                {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Move to Trash
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <div role="status" className="fixed right-4 bottom-4 z-50 flex max-w-md items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
          {toast.kind === "deleted" ? (
            <>
              <Trash2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">Moved <span className="font-medium">{toast.label}</span> to Trash</span>
              <Button size="xs" variant="outline" disabled={busy} onClick={() => undo(toast.batchId)}>
                {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Undo
              </Button>
            </>
          ) : (
            <span className={toast.error ? "text-red-400" : undefined}>{toast.text}</span>
          )}
          <button type="button" aria-label="Dismiss" className="text-muted-foreground" onClick={() => setToast(null)}>
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
