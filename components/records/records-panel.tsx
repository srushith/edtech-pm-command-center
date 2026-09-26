import { FileUp } from "lucide-react";
import { AddRecordButton } from "@/components/records/record-buttons";
import { RecordsTable } from "@/components/records/records-table";
import { ButtonLink } from "@/components/ui/button";
import { isImportType } from "@/lib/import/mapping";
import type { WorkspaceContext } from "@/lib/auth/access";
import { hasRole } from "@/lib/auth/roles";
import { listRecords } from "@/lib/data/records";
import { ENTITY_LABELS, type EntityType } from "@/lib/search-types";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Compact table of a section's records with Add, Edit and Delete (editors and owners only).
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
        {canEdit && (
          <div className="ml-auto flex gap-1.5">
            {isImportType(type) && (
              <ButtonLink size="sm" variant="ghost" href={`/import?type=${type}`}>
                <FileUp /> Import
              </ButtonLink>
            )}
            <AddRecordButton type={type} />
          </div>
        )}
      </div>
      {t.rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {filtered ? "Nothing matches the current filters." : `No ${ENTITY_LABELS[type].toLowerCase()} yet.`}
          {canEdit && !filtered && " Use Add above, or press C anywhere."}
        </p>
      ) : (
        <RecordsTable table={t} />
      )}
    </section>
  );
}
