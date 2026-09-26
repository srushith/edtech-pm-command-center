"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/shell/shell-context";
import { RECORDS } from "@/lib/records/registry";
import type { EntityType } from "@/lib/search-types";

// Rendered only for editors and owners; the server re-checks the role on save.

export function AddRecordButton({ type }: { type: EntityType }) {
  const { openRecordForm, canEdit } = useShell();
  if (!canEdit) return null;
  return (
    <Button size="sm" variant="outline" onClick={() => openRecordForm(type)}>
      <Plus /> Add {RECORDS[type].noun}
    </Button>
  );
}

export function EditRecordButton({ type, id, label }: { type: EntityType; id: string; label?: string }) {
  const { openRecordForm, canEdit } = useShell();
  if (!canEdit) return null;
  return (
    <Button size="xs" variant="ghost" aria-label={label ? `Edit ${label}` : "Edit"} onClick={() => openRecordForm(type, id)}>
      <Pencil /> Edit
    </Button>
  );
}

export function DeleteRecordButton({ type, id, label, onDeleted }: { type: EntityType; id: string; label?: string; onDeleted?: () => void }) {
  const { requestDelete, canEdit } = useShell();
  if (!canEdit) return null;
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={label ? `Delete ${label}` : "Delete"}
      title="Delete"
      className="text-muted-foreground hover:text-red-400"
      onClick={() => requestDelete({ type, ids: [id], onDeleted })}
    >
      <Trash2 />
    </Button>
  );
}
