"use server";

import { revalidatePath } from "next/cache";
import { AccessError } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/access";
import { requireWorkspace } from "@/lib/auth/session";
import { getFormOptions, getRecordForEdit, saveRecord, type SaveResult } from "@/lib/data/records";
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
    const result = await saveRecord(ctx, type, id, values);
    if (result.ok) revalidatePath("/", "layout"); // tables, filters and ⌘K pick it up
    return result;
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}
