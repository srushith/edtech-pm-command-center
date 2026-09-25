"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useShell } from "@/components/shell/shell-context";
import { RecordForm } from "@/components/records/record-form";
import { RECORDS } from "@/lib/records/registry";
import { loadRecordForm, type RecordFormData } from "@/app/(dashboard)/records/actions";
import type { EntityType } from "@/lib/search-types";

/** The one create/edit sheet, opened from Add/Edit buttons, Quick add (C) and ⌘K. */
export function RecordSheet() {
  const router = useRouter();
  const { recordForm, closeRecordForm, invalidateSearch, openRecordForm } = useShell();
  const [data, setData] = useState<{ key: string; form: RecordFormData } | null>(null);
  const [, startLoading] = useTransition();
  const [saved, setSaved] = useState<{ type: EntityType; id: string; label: string; created: boolean } | null>(null);

  const key = recordForm ? `${recordForm.type}:${recordForm.id ?? "new"}` : null;
  useEffect(() => {
    if (!recordForm || !key) return;
    startLoading(async () => {
      const form = await loadRecordForm(recordForm.type, recordForm.id);
      setData({ key, form });
    });
  }, [recordForm, key]);

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(null), 5000);
    return () => window.clearTimeout(t);
  }, [saved]);

  const ready = data && data.key === key ? data.form : null;
  const def = recordForm ? RECORDS[recordForm.type] : null;
  const editing = !!recordForm?.id;

  return (
    <>
      <Sheet open={!!recordForm} onOpenChange={(open) => !open && closeRecordForm()}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-xl data-[side=right]:sm:max-w-xl">
          <SheetHeader className="px-4 pt-4 pb-3">
            <SheetTitle>{def ? `${editing ? "Edit" : "Add"} ${def.noun}` : ""}</SheetTitle>
            <SheetDescription>
              {editing ? "Changes are checked against related records and logged to What changed." : "Saved to this workspace, logged to What changed, and searchable in ⌘K right away."}
            </SheetDescription>
          </SheetHeader>
          {!ready ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : !ready.ok ? (
            <p role="alert" className="mx-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{ready.error}</p>
          ) : (
            <RecordForm
              key={key}
              type={recordForm!.type}
              id={recordForm!.id}
              existing={ready.values}
              initial={ready.values ?? def!.defaults?.(ready.options, new Date(ready.now)) ?? {}}
              options={ready.options}
              onCancel={closeRecordForm}
              onSaved={(r) => {
                setSaved({ type: recordForm!.type, id: r.id, label: r.label, created: !editing });
                closeRecordForm();
                invalidateSearch();
                router.refresh();
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {saved && (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm shadow-md"
        >
          <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
          <span className="truncate">
            {saved.created ? "Added" : "Saved"} {RECORDS[saved.type].noun} <span className="font-medium">{saved.label}</span>
          </span>
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => openRecordForm(saved.type, saved.id)}>
            Edit
          </button>
          <button type="button" aria-label="Dismiss" className="text-muted-foreground" onClick={() => setSaved(null)}>
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
