import { AddRecordButton, EditRecordButton } from "@/components/records/record-buttons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WorkspaceContext } from "@/lib/auth/access";
import { hasRole } from "@/lib/auth/roles";
import { listRecords } from "@/lib/data/records";
import { ENTITY_LABELS, type EntityType } from "@/lib/search-types";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Compact table of a section's records with Add/Edit (editors and owners only).
 * A stand-in until the section's real view ships in its phase.
 */
export async function RecordsPanel({ ctx, type, params }: { ctx: WorkspaceContext; type: EntityType; params: SearchParams }) {
  const t = await listRecords(ctx, type, params);
  const canEdit = hasRole(ctx.role, "EDITOR");
  const filtered = ["course", "cohort", "region"].some((k) => params[k]);

  return (
    <section className="space-y-2" aria-labelledby={`records-${type}`}>
      <div className="flex items-center gap-2">
        <h3 id={`records-${type}`} className="text-sm font-medium">
          {ENTITY_LABELS[type]}{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            · {t.total}
            {t.total > t.rows.length && ` (showing ${t.rows.length})`}
            {filtered && " · filtered"}
          </span>
        </h3>
        {canEdit && <div className="ml-auto"><AddRecordButton type={type} /></div>}
      </div>
      {t.rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {filtered ? "Nothing matches the current filters." : `No ${ENTITY_LABELS[type].toLowerCase()} yet.`}
          {canEdit && !filtered && " Use Add above, or press C anywhere."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {t.columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
                {canEdit && <TableHead className="w-16"><span className="sr-only">Actions</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.rows.map((r) => (
                <TableRow key={r.id}>
                  {r.cells.map((c, i) => (
                    <TableCell key={i} className={i === 0 ? "max-w-72 truncate font-medium" : "max-w-56 truncate text-muted-foreground"}>
                      {c}
                      {i === 0 && r.demo && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/60">demo</span>}
                    </TableCell>
                  ))}
                  {canEdit && (
                    <TableCell className="text-right">
                      <EditRecordButton type={type} id={r.id} label={r.cells[0]} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
