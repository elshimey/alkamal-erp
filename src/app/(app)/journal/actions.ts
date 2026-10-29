"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { once } from "@/lib/once";
import { createManualEntry, deleteManualEntry, postManualEntry, reclassCandidates, reclassify, revertManualEntry, updateManualEntry, updateManualEntryHeader, type ManualLine } from "@/lib/journal";
import type { FormState } from "@/components/action-form";
import type { DocSheetResult, SheetChange } from "@/components/doc-sheet";
import { cell } from "@/lib/sheet-server";

const refresh = () => {
  revalidatePath("/journal");
  revalidatePath("/reports");
  revalidatePath("/");
};

export interface EntryPayload {
  entryDate: string;
  description: string;
  reference: string;
  lines: ManualLine[];
  post: boolean;
  /** معرّف الإرسال من النموذج لمنع إنشاء القيد مرتين */
  op?: string;
}

export async function saveEntry(p: EntryPayload, id?: number): Promise<{ id?: number; error?: string }> {
  const user = await requirePermission("journal_entries", id ? "update" : "create");
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.entryDate)) throw new Error("التاريخ مطلوب");
    const post = p.post && can(user.perms, "journal_entries", "approve");
    const input = {
      entryDate: p.entryDate,
      description: p.description,
      reference: p.reference,
      lines: p.lines.map((l) => ({ accountId: Number(l.accountId), description: l.description, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, costCenterId: l.costCenterId ? Number(l.costCenterId) : null, partyId: l.partyId ? Number(l.partyId) : null })),
      post,
      userId: user.id,
    };
    let entryId = id;
    if (id) await updateManualEntry(db, id, input);
    else entryId = await once(db, p.op, async () => (await createManualEntry(db, input)).id);
    refresh();
    return { id: entryId };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function post(id: number): Promise<FormState> {
  const user = await requirePermission("journal_entries", "approve");
  try {
    const e = await postManualEntry(db, id, user.id);
    refresh();
    return { ok: `رُحّل القيد ${e.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revert(id: number): Promise<FormState> {
  await requirePermission("journal_entries", "revert");
  try {
    await revertManualEntry(db, id);
    refresh();
    return { ok: "أُرجع القيد لمسودة" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function remove(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("journal_entries", "delete");
  try {
    await deleteManualEntry(db, id, { reason: String(fd.get("reason") || "حذف من الشاشة"), userId: user.id });
    refresh();
    return { ok: "حُذف القيد" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function findReclassLines(f: { accountId: number; from?: string; to?: string; costCenterId?: number | null; q?: string }) {
  await requirePermission("journal_entries", "create");
  return reclassCandidates(db, f);
}

export async function reclassifyAction(input: { lineIds: number[]; targetAccountId: number; targetCostCenterId: number | null; date: string; description: string }): Promise<{ ok?: string; id?: number; error?: string }> {
  const user = await requirePermission("journal_entries", "approve");
  try {
    const e = await reclassify(db, { ...input, userId: user.id });
    refresh();
    return { ok: `أُنشئ قيد إعادة التصنيف ${e.number}`, id: e.id };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function saveEntrySheet(payload: string): Promise<DocSheetResult> {
  await requirePermission("journal_entries", "update");
  const changes = JSON.parse(payload) as SheetChange[];
  const errors: Record<number, string> = {};
  let saved = 0;
  for (const { id, values: v } of changes) {
    try {
      await updateManualEntryHeader(db, id, {
        entryDate: v.date !== undefined ? (cell.date(v.date, "التاريخ") ?? undefined) : undefined,
        description: v.description,
        reference: v.reference,
      });
      saved++;
    } catch (err) {
      errors[id] = errorMessage(err);
    }
  }
  refresh();
  return { ok: saved ? `حُفظت تعديلات ${saved} قيد` : undefined, errors };
}
