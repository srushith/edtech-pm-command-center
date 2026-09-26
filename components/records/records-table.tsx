"use client";

import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { DeleteRecordButton, EditRecordButton } from "@/components/records/record-buttons";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RecordTable } from "@/lib/data/records";
import { ENTITY_LABELS } from "@/lib/search-types";

const checkboxClass = "size-3.5 cursor-pointer accent-foreground align-middle";

/** A section's records. Editors and owners get row Edit/Delete and a selection for bulk delete. */
export function RecordsTable({ table }: { table: RecordTable }) {
  const { canEdit, requestDelete } = useShell();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { type, columns, rows } = table;
  // Rows can disappear after a delete or refresh: only count what's still listed.
  const chosen = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const all = rows.length > 0 && chosen.length === rows.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clear = () => setSelected(new Set());

  return (
    <div className="space-y-2">
      {canEdit && chosen.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs" role="region" aria-label="Selection">
          <span className="tabular-nums">{chosen.length} selected</span>
          <Button size="xs" variant="outline" className="text-red-400" onClick={() => requestDelete({ type, ids: chosen, onDeleted: clear })}>
            <Trash2 /> Delete
          </Button>
          <Button size="xs" variant="ghost" className="ml-auto" onClick={clear}>
            <X /> Clear
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {canEdit && (
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={all}
                    ref={(el) => {
                      if (el) el.indeterminate = chosen.length > 0 && !all;
                    }}
                    onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
                    aria-label={`Select all ${ENTITY_LABELS[type].toLowerCase()} shown`}
                  />
                </TableHead>
              )}
              {columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
              {canEdit && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                {canEdit && (
                  <TableCell>
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select ${r.cells[0]}`}
                    />
                  </TableCell>
                )}
                {r.cells.map((c, i) => (
                  <TableCell key={i} className={i === 0 ? "max-w-72 truncate font-medium" : "max-w-56 truncate text-muted-foreground"}>
                    {c}
                    {i === 0 && r.demo && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/60">demo</span>}
                  </TableCell>
                ))}
                {canEdit && (
                  <TableCell className="text-right whitespace-nowrap">
                    <EditRecordButton type={type} id={r.id} label={r.cells[0]} />
                    <DeleteRecordButton type={type} id={r.id} label={r.cells[0]} onDeleted={() => setSelected((s) => { const n = new Set(s); n.delete(r.id); return n; })} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
