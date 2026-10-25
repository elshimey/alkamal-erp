"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { canBulkEdit, saveBulk, type BulkChange, type BulkResult } from "@/lib/bulk-records";
import { deleteRecord, isRecordKind, parseForm, RECORDS, recordHref, saveRecord } from "@/lib/records";
import { errorMessage, findPgError } from "@/lib/errors";
import type { FormState } from "@/components/action-form";

export async function saveRecordAction(kind: string, id: number, _: FormState, data: FormData): Promise<FormState> {
  if (!isRecordKind(kind)) return { error: "نوع غير معروف" };
  const def = RECORDS[kind];
  const me = await requirePermission(def.perm, "update");
  try {
    const values = parseForm(def, data);
    if (kind === "users" && id === me.id && !values.isActive) throw new Error("لا يمكنك إيقاف حسابك أنت");
    await saveRecord(kind, id, values);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(def.listHref);
  revalidatePath(recordHref(kind, id));
  return { ok: "حُفظت التعديلات" };
}

export async function deleteRecordAction(kind: string, id: number, _: FormState, data: FormData): Promise<FormState> {
  if (!isRecordKind(kind)) return { error: "نوع غير معروف" };
  const def = RECORDS[kind];
  const me = await requirePermission(def.perm, "delete");
  try {
    if (String(data.get("confirm") ?? "").trim() !== "حذف") throw new Error("اكتب كلمة «حذف» للتأكيد");
    if (kind === "users" && id === me.id) throw new Error("لا يمكنك حذف حسابك أنت");
    await deleteRecord(kind, id);
  } catch (err) {
    if (findPgError(err)?.code === "23503")
      return { error: `لا يمكن حذف ${def.noun} لوجود حركات أو بيانات مرتبطة.${def.instead ? ` ${def.instead} بدلاً من الحذف.` : ""}` };
    return { error: errorMessage(err) };
  }
  revalidatePath(def.listHref);
  redirect(`${def.listHref}?deleted=1`);
}

export async function saveBulkAction(kind: string, changes: BulkChange[], deletes: number[]): Promise<BulkResult> {
  if (!isRecordKind(kind) || !canBulkEdit(kind)) return { saved: 0, deleted: 0, errors: {}, error: "نوع غير معروف" };
  const def = RECORDS[kind];
  const me = await requirePermission(def.perm, "update");
  if (deletes.length && !can(me.perms, def.perm, "delete")) return { saved: 0, deleted: 0, errors: {}, error: "ليست لديك صلاحية الحذف" };
  const result = await saveBulk(kind, changes, deletes);
  revalidatePath(def.listHref);
  return result;
}
