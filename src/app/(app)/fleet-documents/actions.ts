"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { saveDataUrl } from "@/lib/attachments";
import { addDocument, OWNER_KINDS, parseAlertDays, parseOwnerKey, type Blocking, type OwnerKind } from "@/lib/documents";
import type { FormState } from "@/components/action-form";

const str = (d: FormData, k: string) => String(d.get(k) ?? "").trim();

export async function addDocumentAction(_: FormState, data: FormData): Promise<FormState> {
  const user = await requirePermission("fleet_documents", "create");
  const owner = parseOwnerKey(str(data, "owner"));
  if (!owner) return { error: "اختر صاحب الوثيقة" };
  const cost = str(data, "cost");
  try {
    await db.transaction(async (tx) => {
      const { row } = await addDocument(tx, {
        documentTypeId: Number(str(data, "documentTypeId")),
        owner,
        number: str(data, "number"),
        issueDate: str(data, "issueDate") || null,
        expiryDate: str(data, "expiryDate") || null,
        authority: str(data, "authority"),
        cost: cost === "" ? null : Number(cost),
        notes: str(data, "notes"),
        userId: user.id,
      });
      await saveDataUrl(tx, { entity: "fleet_documents", entityId: row.id, kind: "document", dataUrl: str(data, "file"), userId: user.id });
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/fleet-documents");
  redirect(`/fleet-documents/owner/${owner.kind}-${owner.id}?saved=1`);
}

/** إرفاق صورة أو PDF بوثيقة محفوظة سابقاً. */
export async function attachDocumentAction(_: FormState, data: FormData): Promise<FormState> {
  const user = await requirePermission("fleet_documents", "update");
  const id = Number(str(data, "id"));
  const file = str(data, "file");
  if (!file) return { error: "اختر الملف أولاً" };
  try {
    const [doc] = await db.select({ id: s.fleetDocuments.id }).from(s.fleetDocuments).where(eq(s.fleetDocuments.id, id));
    if (!doc) return { error: "الوثيقة غير موجودة" };
    await saveDataUrl(db, { entity: "fleet_documents", entityId: id, kind: "document", dataUrl: file, userId: user.id });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/fleet-documents", "layout");
  return { ok: "أُرفق الملف" };
}

/** إضافة نوع وثيقة أو تعديله من الإعدادات. */
export async function saveDocumentTypeAction(_: FormState, data: FormData): Promise<FormState> {
  await requirePermission("settings", "update");
  const id = Number(str(data, "id")) || null;
  const nameAr = str(data, "nameAr");
  const ownerKind = str(data, "ownerKind") as OwnerKind;
  const blocking = str(data, "blocking") as Blocking;
  const alertDays = parseAlertDays(str(data, "alertDays"));
  if (!nameAr) return { error: "اكتب اسم الوثيقة" };
  if (!(ownerKind in OWNER_KINDS)) return { error: "اختر صاحب الوثيقة" };
  if (!["block", "international", "alert"].includes(blocking)) return { error: "اختر أثر الانتهاء" };
  if (!alertDays.length) return { error: "اكتب أيام التنبيه، مثل 60,30,7" };
  const values = {
    nameAr,
    ownerKind,
    blocking,
    alertDays: alertDays.join(","),
    required: data.get("required") === "on",
    isActive: data.get("isActive") === "on",
    authority: str(data, "authority") || null,
  };
  try {
    if (id) {
      // لا يُغيَّر صاحب نوع عليه وثائق مسجلة
      const [used] = await db.select({ id: s.fleetDocuments.id }).from(s.fleetDocuments).where(eq(s.fleetDocuments.documentTypeId, id)).limit(1);
      const [before] = await db.select().from(s.documentTypes).where(eq(s.documentTypes.id, id));
      if (!before) return { error: "النوع غير موجود" };
      if (used && before.ownerKind !== ownerKind) return { error: "عليه وثائق مسجلة؛ لا يمكن تغيير صاحبه" };
      await db.update(s.documentTypes).set(values).where(eq(s.documentTypes.id, id));
    } else {
      await db.insert(s.documentTypes).values({ ...values, code: `x_${Date.now().toString(36)}`, sortOrder: 900 });
    }
  } catch (err) {
    const msg = errorMessage(err);
    return { error: msg.includes("document_types_owner_name") ? "يوجد نوع بنفس الاسم لنفس الصاحب" : msg };
  }
  revalidatePath("/settings/document-types");
  revalidatePath("/fleet-documents", "layout");
  return { ok: id ? "حُفظ النوع" : `أُضيف «${nameAr}»` };
}
