"use server";

import { revalidatePath } from "next/cache";
import { signIn } from "@/lib/auth";
import { requireRole } from "@/lib/auth/access";
import { AccessError } from "@/lib/auth/roles";
import { requireWorkspace } from "@/lib/auth/session";
import {
  ImportError, prepareMapping, previewImport, runImport, syncImportSource,
  type ImportRequest, type ImportSourceInput, type MappingHelp, type Preview, type RunResult,
} from "@/lib/data/imports";
import { listTabs, parseSheetLink, SHEETS_SCOPE, SheetsError, sheetsAccessToken, type SheetTab } from "@/lib/google/sheets";
import { isImportType } from "@/lib/import/mapping";
import { safeRedirect } from "@/lib/safe-redirect";

export type ActionError = { ok: false; error: string; code?: string };
type Result<T> = ({ ok: true } & T) | ActionError;

// Every action re-resolves the workspace; lib/data/imports checks the editor role.
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof AccessError || e instanceof ImportError) return { ok: false, error: e.message };
    if (e instanceof SheetsError) return { ok: false, error: e.message, code: e.code };
    throw e;
  }
}

function checkRequest(type: string, source: ImportSourceInput) {
  if (!isImportType(type)) throw new ImportError("That record type can't be imported.");
  if (source.kind !== "CSV" && source.kind !== "SHEET") throw new ImportError("Unknown source.");
}

/** Resolve a pasted Google Sheets link to its tabs, with the user's own Google access. */
export async function openSheetAction(link: string): Promise<Result<{ spreadsheetId: string; title: string; tabs: SheetTab[]; sheetId: number | null }>> {
  const ctx = await requireWorkspace();
  return attempt(async () => {
    requireRole(ctx, "EDITOR", "Importing");
    const ref = parseSheetLink(link);
    if (!ref) throw new ImportError("That doesn't look like a Google Sheets link (docs.google.com/spreadsheets/d/…).");
    const token = await sheetsAccessToken(ctx.user.id);
    const { title, tabs } = await listTabs(token, ref.spreadsheetId);
    const sheetId = ref.sheetId != null && tabs.some((t) => t.sheetId === ref.sheetId) ? ref.sheetId : (tabs[0]?.sheetId ?? null);
    return { spreadsheetId: ref.spreadsheetId, title, tabs, sheetId };
  });
}

export async function prepareMappingAction(type: string, source: ImportSourceInput): Promise<Result<{ help: MappingHelp }>> {
  const ctx = await requireWorkspace();
  return attempt(async () => {
    checkRequest(type, source);
    return { help: await prepareMapping(ctx, type as ImportRequest["type"], source) };
  });
}

export async function previewImportAction(req: ImportRequest): Promise<Result<{ preview: Preview }>> {
  const ctx = await requireWorkspace();
  return attempt(async () => {
    checkRequest(req.type, req.source);
    return { preview: await previewImport(ctx, req) };
  });
}

export async function runImportAction(req: ImportRequest): Promise<Result<{ result: RunResult }>> {
  const ctx = await requireWorkspace();
  const r = await attempt(async () => {
    checkRequest(req.type, req.source);
    return { result: await runImport(ctx, req) };
  });
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function syncSourceAction(sourceId: string): Promise<Result<{ result: RunResult }>> {
  const ctx = await requireWorkspace();
  const r = await attempt(async () => ({ result: await syncImportSource(ctx, sourceId) }));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/**
 * Ask Google for read-only Sheets access, only when someone chooses to import from a
 * sheet. include_granted_scopes keeps the existing sign-in scopes; offline + consent
 * returns a refresh token so "Sync now" keeps working later.
 */
export async function grantSheetsAccessAction(returnTo: string): Promise<void> {
  const ctx = await requireWorkspace();
  requireRole(ctx, "EDITOR", "Importing");
  await signIn(
    "google",
    { redirectTo: safeRedirect(returnTo) },
    {
      scope: `openid email profile ${SHEETS_SCOPE}`,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      login_hint: ctx.user.email,
    },
  );
}
