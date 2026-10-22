"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { createNote, deleteNote, invoiceLinesForNote, postNote, revertNote } from "@/lib/notes";
import { NOTE_KINDS, NOTE_SIDES, type NoteKind, type NoteSide } from "@/data/sales";
import type { FormState } from "@/components/action-form";
import { autoSubmit, submitDocument } from "@/lib/zatca/service";

const sideOf = (side: string): NoteSide => {
  if (side !== "sales" && side !== "purchase") throw new Error("نوع غير معروف");
  return side;
};
const refresh = (side: NoteSide) => {
  revalidatePath(`/notes/${side}`);
  revalidatePath(NOTE_SIDES[side].invoices);
  revalidatePath(side === "sales" ? "/customers" : "/payments");
};

/** فواتير الجهة المُصدرة/المرحّلة لاختيار الفاتورة الأصلية. */
export async function partyInvoices(sideRaw: string, partyId: number) {
  const side = sideOf(sideRaw);
  await requirePermission(NOTE_SIDES[side].entity, "create");
  if (side === "sales") {
    const t = s.salesInvoices;
    return db
      .select({ id: t.id, number: t.number, date: t.invoiceDate, total: t.total, paid: t.paidAmount, currencyCode: t.currencyCode, ref: t.reference })
      .from(t)
      .where(and(eq(t.customerId, partyId), eq(t.status, "issued")))
      .orderBy(sql`${t.invoiceDate} desc`, asc(t.id));
  }
  const t = s.purchaseInvoices;
  return db
    .select({ id: t.id, number: t.number, date: t.invoiceDate, total: t.total, paid: t.paidAmount, currencyCode: t.currencyCode, ref: t.supplierInvoiceNo })
    .from(t)
    .where(and(eq(t.supplierId, partyId), eq(t.status, "posted")))
    .orderBy(sql`${t.invoiceDate} desc`, asc(t.id));
}

export async function invoiceLines(sideRaw: string, invoiceId: number) {
  const side = sideOf(sideRaw);
  await requirePermission(NOTE_SIDES[side].entity, "create");
  return invoiceLinesForNote(db, side, invoiceId);
}

export interface NotePayload {
  kind: NoteKind;
  noteDate: string;
  partyId: number;
  invoiceId: number | null;
  currencyCode: string;
  reason: string;
  lines: { description: string; accountId: number; costCenterId: number | null; amount: number; vatRate: number }[];
}

export async function saveNote(p: NotePayload): Promise<{ id?: number; error?: string }> {
  try {
    const k = NOTE_KINDS[p.kind];
    if (!k) throw new Error("نوع الإشعار غير معروف");
    const entity = NOTE_SIDES[k.side].entity;
    const user = await requirePermission(entity, "create");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.noteDate)) throw new Error("التاريخ مطلوب");
    const n = await createNote(db, {
      kind: p.kind,
      noteDate: p.noteDate,
      partyId: Number(p.partyId),
      invoiceId: p.invoiceId ? Number(p.invoiceId) : null,
      currencyCode: p.currencyCode,
      reason: p.reason,
      lines: p.lines.map((l) => ({ description: l.description.trim(), accountId: Number(l.accountId), costCenterId: l.costCenterId ? Number(l.costCenterId) : null, amount: Number(l.amount), vatRate: Number(l.vatRate) })),
      post: can(user.perms, entity, "approve"),
      userId: user.id,
    });
    if (k.side === "sales" && can(user.perms, entity, "approve")) await autoSubmit(db, { noteId: n.id }, user.id);
    refresh(k.side);
    return { id: n.id };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function post(sideRaw: string, id: number): Promise<FormState> {
  const side = sideOf(sideRaw);
  const user = await requirePermission(NOTE_SIDES[side].entity, "approve");
  try {
    const { entry } = await postNote(db, id, user.id);
    const zatca = side === "sales" ? await autoSubmit(db, { noteId: id }, user.id) : null;
    refresh(side);
    return { ok: `رُحّل القيد ${entry.number}${zatca ? ` ${zatca}` : ""}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revert(sideRaw: string, id: number): Promise<FormState> {
  const side = sideOf(sideRaw);
  await requirePermission(NOTE_SIDES[side].entity, "revert");
  try {
    await revertNote(db, id);
    refresh(side);
    return { ok: "أُرجع الإشعار لمسودة" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function remove(sideRaw: string, id: number, _: FormState, fd: FormData): Promise<FormState> {
  const side = sideOf(sideRaw);
  const user = await requirePermission(NOTE_SIDES[side].entity, "delete");
  try {
    await deleteNote(db, id, { reason: String(fd.get("reason") || "حذف من الشاشة"), userId: user.id });
    refresh(side);
    return { ok: "حُذف الإشعار" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** إرسال إشعار العميل (أو إعادة إرساله) لبوابة فاتورة. */
export async function sendToZatca(id: number): Promise<FormState> {
  const user = await requirePermission(NOTE_SIDES.sales.entity, "approve");
  try {
    const row = await submitDocument(db, { noteId: id }, user.id);
    refresh("sales");
    if (row.status === "cleared") return { ok: "اعتمدت الهيئة الإشعار" };
    if (row.status === "cleared_warnings") return { ok: `اعتمدت الهيئة الإشعار بملاحظات: ${row.warnings.join(" · ")}` };
    return { error: `لم تعتمد الهيئة الإشعار: ${(row.errors as string[]).join(" · ")}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
