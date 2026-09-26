"use server";

import { revalidatePath } from "next/cache";
import { AccessError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/access";
import { requireWorkspace } from "@/lib/auth/session";
import { getFormOptions, getRecordForEdit, saveRecord, setInstructorsInactive, type SaveResult } from "@/lib/data/records";
import { deleteRecords, previewDelete, purgeExpiredTrash, undoDelete, type DeletePreview, type DeleteResult } from "@/lib/data/trash";
import type { FormOptions, Values } from "@/lib/records/kit";
import { isRecordType } from "@/lib/records/registry";

export type RecordFormData =
  | { ok: true; values: Values | null; options: FormOptions; now: string }
  | { ok: false; error: string };

// Both actions re-resolve the workspace and check the role server-side;
// the hidden Add/Edit buttons for viewers are only a convenience.

export async function loadRecordForm(type: string, id: string | null): Promise<RecordFormData> {
  if (!isRecordType(type)) return { ok: false, error: "Unknown record type." };
  const ctx = await requireWorkspace();
  try {
    requireRole(ctx, "EDITOR", "Adding and editing records");
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, error: e.message };
    throw e;
  }
  const [values, options] = await Promise.all([id ? getRecordForEdit(ctx, type, id) : null, getFormOptions(ctx)]);
  if (id && !values) return { ok: false, error: "That record doesn't exist in this workspace." };
  return { ok: true, values, options, now: new Date().toISOString() };
}

export async function saveRecordAction(type: string, id: string | null, values: Values): Promise<SaveResult> {
  if (!isRecordType(type)) return { ok: false, errors: { _form: "Unknown record type." } };
  const ctx = await requireWorkspace();
  try {
    await purgeExpiredTrash(ctx); // frees codes held by items older than 30 days
    const result = await saveRecord(ctx, type, id, values);
    if (result.ok) revalidatePath("/", "layout"); // tables, filters and ⌘K pick it up
    return result;
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

// ---------- Delete (editors and owners; lib/data/trash enforces the roles) ----------

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, error: e.message };
    throw e;
  }
}

const cleanIds = (ids: unknown) => (Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string") : []);

export async function previewDeleteAction(type: string, ids: string[]): Promise<Result<{ preview: DeletePreview }>> {
  if (!isRecordType(type)) return { ok: false, error: "Unknown record type." };
  const ctx = await requireWorkspace();
  return attempt(async () => ({ preview: await previewDelete(ctx, type, cleanIds(ids)) }));
}

export async function deleteRecordsAction(type: string, ids: string[], confirm: string | null): Promise<Result<DeleteResult>> {
  if (!isRecordType(type)) return { ok: false, error: "Unknown record type." };
  const ctx = await requireWorkspace();
  const r = await attempt(() => deleteRecords(ctx, type, cleanIds(ids), typeof confirm === "string" ? confirm : null));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function undoDeleteAction(batchId: string): Promise<Result<{ label: string }>> {
  const ctx = await requireWorkspace();
  const r = await attempt(() => undoDelete(ctx, String(batchId)));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** The alternative to deleting instructors who have sessions. */
export async function markInstructorsInactiveAction(ids: string[]): Promise<Result<{ changed: number }>> {
  const ctx = await requireWorkspace();
  const r = await attempt(async () => ({ changed: await setInstructorsInactive(ctx, cleanIds(ids)) }));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
