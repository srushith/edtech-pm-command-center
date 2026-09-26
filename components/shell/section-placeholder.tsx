import { DeleteRecordButton, EditRecordButton } from "@/components/records/record-buttons";
import { RecordsPanel } from "@/components/records/records-panel";
import { StatusBadge } from "@/components/status-badge";
import { requireWorkspace } from "@/lib/auth/session";
import { getFocusedEntity } from "@/lib/data/search";
import { describeDateRange, parseFilters, REGION_LABELS } from "@/lib/filters";
import { MODE_LABELS } from "@/lib/mode";
import { getMode } from "@/lib/mode-server";
import { sectionById, type SectionId } from "@/lib/nav";
import { SECTION_RECORDS } from "@/lib/records/registry";
import { ENTITY_LABELS } from "@/lib/search-types";

type SearchParams = Record<string, string | string[] | undefined>;

// Stand-in for sections that later phases build out: the section's records (with
// Add/Edit for editors), the record opened from ⌘K, or the active view for sections
// without records yet.
export async function SectionPlaceholder({
  id,
  searchParams,
}: {
  id: SectionId;
  searchParams: Promise<SearchParams>;
}) {
  const section = sectionById(id);
  const params = await searchParams;
  const focusParam = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const ctx = await requireWorkspace();
  const [mode, focused] = await Promise.all([getMode(params), getFocusedEntity(ctx, focusParam)]);
  const filters = parseFilters(params);
  const Icon = section.icon;
  const recordTypes = SECTION_RECORDS[id] ?? [];

  const rows: [string, string][] = [
    ["Course", filters.course ?? "All"],
    ["Cohort", filters.cohort ?? "All"],
    ["Region", filters.region ? REGION_LABELS[filters.region] : "All"],
    ["Date range", describeDateRange(filters)],
    ["Mode", MODE_LABELS[mode]],
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Icon className="size-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
          <StatusBadge status="info">Arrives in Phase {section.phase}</StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">{section.description}</p>
      </header>

      {focusParam && (
        <section className="rounded-md border px-4 py-3" aria-label="Focused record">
          <p className="text-xs text-muted-foreground">Opened from ⌘K</p>
          {focused ? (
            <div className="mt-1 flex items-start gap-3">
              <p className="min-w-0 flex-1 text-sm">
                <span className="text-muted-foreground">{ENTITY_LABELS[focused.type]} · </span>
                <span className="font-medium">{focused.label}</span>
                <span className="block text-xs text-muted-foreground">{focused.sublabel}</span>
              </p>
              <EditRecordButton type={focused.type} id={focused.id} label={focused.label} />
              <DeleteRecordButton type={focused.type} id={focused.id} label={focused.label} />
            </div>
          ) : (
            <p className="mt-1 text-sm text-amber-400">Record not found: it may have been deleted. ({focusParam})</p>
          )}
        </section>
      )}

      {recordTypes.map((t) => (
        <RecordsPanel key={t} ctx={ctx} type={t} params={params} />
      ))}

      {recordTypes.length === 0 && (
      <section className="rounded-md border" aria-label="Active view">
        <h3 className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">Active view (from URL)</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-3">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      )}
    </div>
  );
}
