"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { saveDataUrl } from "@/lib/attachments";
import { addDocument, approveSubmission, rejectSubmission, OWNER_KINDS, parseAlertDays, parseOwnerKey, type Blocking, type OwnerKind } from "@/lib/documents";
import { loadRecord, parseForm, RECORDS, saveRecord } from "@/lib/records";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import type { FormState } from "@/components/action-form";
import type { PanelResult } from "@/components/record-panel";

const str = (d: FormData, k: string) => String(d.get(k) ?? "").trim();

/** حفظ وثيقة واحدة من النافذة: إضافة (أو تجديد) أو تعديل، مع المرفق في المعاملة نفسها. */
export async function saveDocumentAction(id: number | null, data: FormData): Promise<PanelResult> {
  const user = await requirePermission("fleet_documents", id ? "update" : "create");
  const file = str(data, "file");
  try {
    if (id) {
      const docId = id;
      const current = await loadRecord("fleet_documents", id);
      if (!current) return { error: "الوثيقة غير موجودة" };
      const values = { ...current, ...parseForm(RECORDS.fleet_documents, data) };
      await saveRecord("fleet_documents", id, values, async (tx) => {
        await saveDataUrl(tx, { entity: "fleet_documents", entityId: docId, kind: "document", dataUrl: file, userId: user.id });
      });
    } else {
      const owner = parseOwnerKey(str(data, "owner"));
      if (!owner) return { error: "اختر صاحب الوثيقة" };
      if (!Number(str(data, "documentTypeId"))) return { error: "اختر نوع الوثيقة" };
      const cost = str(data, "cost");
      id = await db.transaction(async (tx) => {
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
        await saveDataUrl(tx, { entity: "fleet_documents", entityId: row.id, kind: "document", dataUrl: file, userId: user.id });
        return row.id;
      });
    }
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/fleet-documents", "layout");
  return { ok: "حُفظت الوثيقة", id, label: "" };
}

/** إضافة جماعية من الشيت: صف لكل وثيقة (المرفقات تُضاف بعدها من نافذة الوثيقة). */
export async function saveDocumentsSheet(rows: SheetRow[]) {
  const user = await requirePermission("fleet_documents", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const owner = parseOwnerKey(cell.required(r.owner, "صاحب الوثيقة"));
    if (!owner) throw new Error("صاحب الوثيقة غير معروف");
    await addDocument(db, {
      documentTypeId: Number(cell.required(r.documentTypeId, "نوع الوثيقة")),
      owner,
      number: cell.text(r.number) ?? "",
      issueDate: cell.date(r.issueDate, "تاريخ الإصدار"),
      expiryDate: cell.date(r.expiryDate, "تاريخ الانتهاء"),
      authority: cell.text(r.authority) ?? "",
      cost: cell.number(r.cost, "الرسوم"),
      notes: cell.text(r.notes) ?? "",
      userId: user.id,
    });
  });
  revalidatePath("/fleet-documents", "layout");
  return result;
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

/** اعتماد وثيقة مجددة رفعها السائق: تُسجَّل وثيقة جديدة بتاريخ الانتهاء الجديد وتنتقل الصورة إليها. */
export async function approveSubmissionAction(_: FormState, data: FormData): Promise<FormState> {
  const user = await requirePermission("fleet_documents", "update");
  const cost = str(data, "cost");
  try {
    await approveSubmission(db, Number(str(data, "id")), {
      number: str(data, "number"),
      issueDate: str(data, "issueDate") || null,
      expiryDate: str(data, "expiryDate") || null,
      cost: cost === "" ? null : Number(cost),
      userId: user.id,
    });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/fleet-documents", "layout");
  return { ok: "اعتُمدت وسُجلت الوثيقة الجديدة" };
}

export async function rejectSubmissionAction(_: FormState, data: FormData): Promise<FormState> {
  const user = await requirePermission("fleet_documents", "update");
  try {
    await rejectSubmission(db, Number(str(data, "id")), str(data, "reason"), user.id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/fleet-documents", "layout");
  return { ok: "رُفض الطلب وسيرى السائق السبب" };
}
