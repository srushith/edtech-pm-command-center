import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { AccessError, hasRole } from "@/lib/auth/roles";
import { requireWorkspace } from "@/lib/auth/session";
import { getImportSource, ImportError, listImportSources, prepareMapping, previewImport, type ImportSourceInput } from "@/lib/data/imports";
import { hasSheetsGrant, listTabs, parseSheetLink, SheetsError, sheetsAccessToken } from "@/lib/google/sheets";
import { isImportType, type ImportType, type Mapping } from "@/lib/import/mapping";
import { ImportWizard, type WizardStart } from "./import-wizard";
import { SourcesList } from "./sources-list";

export const metadata: Metadata = { title: "Import" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const ctx = await requireWorkspace();
  const params = await searchParams;

  if (!hasRole(ctx.role, "EDITOR")) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-2 px-4 py-8 sm:px-6">
        <h2 className="text-xl font-semibold tracking-tight">Import</h2>
        <p className="text-sm text-muted-foreground">Importing is for editors and owners. Ask a workspace owner if you need to bring data in.</p>
      </div>
    );
  }

  const [sources, sheetsGranted] = await Promise.all([listImportSources(ctx), hasSheetsGrant(ctx.user.id)]);

  // Where the wizard starts: a saved source ("Import again"), a sheet link coming back from the
  // Google grant, or a type chosen from a section page.
  let start: WizardStart = { type: isImportType(first(params.type)) ? (first(params.type) as ImportType) : "course" };
  const sourceId = first(params.source);
  if (sourceId) {
    try {
      const s = await getImportSource(ctx, sourceId);
      const source: ImportSourceInput | null =
        s.kind === "SHEET" && s.spreadsheetId && s.sheetId != null ? { kind: "SHEET", spreadsheetId: s.spreadsheetId, sheetId: s.sheetId } : null;
      start = { type: s.entityType as ImportType, saved: { id: s.id, name: s.name, kind: s.kind, source, mapping: s.mapping as Mapping } };
    } catch (e) {
      if (!(e instanceof ImportError)) throw e;
    }
  }
  const sheetLink = first(params.sheet);
  if (sheetLink) start = { ...start, sheetLink };

  // Do the first step here so the wizard opens on it: a saved sheet goes straight to the
  // preview (or mapping, if its columns changed); a link back from the Google grant opens its tabs.
  const known = (e: unknown) => e instanceof SheetsError || e instanceof ImportError || e instanceof AccessError;
  const asError = (e: unknown) => ({ message: (e as Error).message, code: e instanceof SheetsError ? e.code : undefined });
  const savedSource = start.saved?.source;
  try {
    if (savedSource) {
      const help = await prepareMapping(ctx, start.type, savedSource);
      start = { ...start, help };
      if (help.saved && help.savedMatches) {
        start = { ...start, preview: await previewImport(ctx, { type: start.type, source: savedSource, mapping: help.saved }) };
      }
    } else if (sheetLink && sheetsGranted) {
      const ref = parseSheetLink(sheetLink);
      if (ref) {
        const { title, tabs } = await listTabs(await sheetsAccessToken(ctx.user.id), ref.spreadsheetId);
        const sheetId = ref.sheetId != null && tabs.some((t) => t.sheetId === ref.sheetId) ? ref.sheetId : (tabs[0]?.sheetId ?? null);
        start = { ...start, sheet: { spreadsheetId: ref.spreadsheetId, title, tabs, sheetId } };
      }
    }
  } catch (e) {
    if (!known(e)) throw e;
    start = { ...start, error: asError(e) };
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Import</h2>
          <StatusBadge status="info">CSV · Google Sheets</StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          Bring in courses, cohorts, instructors, SMEs and modules. Rows are checked with the same rules as the Add forms and
          matched to existing records by name, so re-importing updates instead of duplicating.
        </p>
      </header>

      <ImportWizard key={`${start.type}:${start.saved?.id ?? ""}:${sheetLink ?? ""}`} start={start} sheetsGranted={sheetsGranted} />

      <SourcesList sources={sources} />
    </div>
  );
}
