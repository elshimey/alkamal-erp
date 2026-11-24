"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { createPayment, deletePayment, paymentToInput, postPayment, revertPayment, updatePayment, type PaymentInput } from "@/lib/purchases";
import type { PanelResult } from "@/components/record-panel";
import type { DocSheetResult, SheetChange } from "@/components/doc-sheet";
import { PAYMENT_METHODS } from "@/data/sales";
import type { FormState } from "@/components/action-form";

const refresh = () => {
  revalidatePath("/payments");
  revalidatePath("/purchases");
  revalidatePath("/expenses");
  revalidatePath("/");
};

export async function savePayments(rows: SheetRow[]) {
  const user = await requirePermission("payments", "create");
  const post = can(user.perms, "payments", "approve");
  const result = await saveSheetRows(rows, async (r) => {
    const amount = cell.number(r.amount, "المبلغ");
    if (!amount) throw new Error("المبلغ إلزامي");
    const method = cell.required(r.method, "طريقة الدفع");
    if (!(method in PAYMENT_METHODS)) throw new Error("طريقة الدفع غير معروفة");
    // اختيار السائق يعني صرف عهدة، واختيار المورد يعني سداداً
    const kind = r.driverId && !r.partyId ? "custody" : "supplier";
    if (r.driverId && r.partyId) throw new Error("اختر المورد أو السائق، لا الاثنين");
    await createPayment(db, {
      // التاريخ الفارغ = اليوم، كما يظهر في الخلية
      paymentDate: cell.date(r.date, "التاريخ") ?? todayRiyadh(),
      kind,
      partyId: r.partyId ? Number(r.partyId) : null,
      driverId: r.driverId ? Number(r.driverId) : null,
      amount,
      currencyCode: r.currency === "KWD" ? "KWD" : "SAR",
      exchangeRate: cell.number(r.rate, "سعر الصرف"),
      method: method as keyof typeof PAYMENT_METHODS,
      cashAccountId: Number(cell.required(r.cashAccountId, "الصندوق / البنك")),
      invoiceId: r.invoiceId ? Number(r.invoiceId) : null,
      reference: cell.text(r.reference),
      notes: cell.text(r.notes),
      post,
      userId: user.id,
    });
  });
  refresh();
  return result;
}

export async function post(id: number): Promise<FormState> {
  const user = await requirePermission("payments", "approve");
  try {
    const { entry, unallocated } = await postPayment(db, id, { userId: user.id });
    refresh();
    return { ok: `رُحّل القيد ${entry.number}${unallocated > 0 ? ` (غير مخصص على فواتير ${unallocated.toLocaleString("en")})` : ""}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revert(id: number): Promise<FormState> {
  await requirePermission("payments", "revert");
  try {
    await revertPayment(db, id);
    refresh();
    return { ok: "أُرجع السند لمسودة" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function remove(id: number): Promise<FormState> {
  const user = await requirePermission("payments", "delete");
  try {
    await deletePayment(db, id, { reason: "حذف من الشاشة", userId: user.id });
    refresh();
    return { ok: "حُذف السند" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** المرحّل يُعاد قيده عند التعديل، فيحتاج صلاحية الإرجاع مع التعديل. */
async function editablePayment(id: number, perms: Parameters<typeof can>[0]) {
  const [p] = await db.select().from(s.payments).where(eq(s.payments.id, id));
  if (!p) throw new Error("السند غير موجود");
  if (p.status === "posted" && !can(perms, "payments", "revert")) throw new Error(`السند ${p.number} مرحّل؛ تعديله يعيد قيده ويحتاج صلاحية الإرجاع`);
  return p;
}

const methodOf = (v: string) => {
  if (!(v in PAYMENT_METHODS)) throw new Error("اختر طريقة الدفع");
  return v as keyof typeof PAYMENT_METHODS;
};

/** نافذة سند الصرف الواحد: جديد (مسودة أو «حفظ وترحيل») أو تعديل (المرحّل يُعاد ترحيله). */
export async function savePaymentPanel(editId: number | null, data: FormData): Promise<PanelResult> {
  const user = await requirePermission("payments", editId ? "update" : "create");
  const get = (k: string) => String(data.get(k) ?? "").trim();
  const id = (k: string) => Number(get(k)) || null;
  try {
    const current = editId ? await editablePayment(editId, user.perms) : null;
    const kind = (get("kind") || current?.kind || "supplier") as PaymentInput["kind"];
    const input: PaymentInput = {
      paymentDate: get("date") || todayRiyadh(),
      kind,
      debitAccountId: current?.debitAccountId,
      partyId: kind === "supplier" ? id("partyId") : null,
      driverId: kind === "custody" ? id("driverId") : null,
      amount: Number(get("amount").replace(/,/g, "")) || 0,
      currencyCode: get("currency") === "KWD" ? "KWD" : "SAR",
      method: methodOf(get("method")),
      cashAccountId: Number(get("cashAccountId")) || 0,
      invoiceId: kind === "supplier" ? id("invoiceId") : null,
      reference: get("reference") || null,
      notes: get("notes") || null,
      post: get("post") === "1" && can(user.perms, "payments", "approve"),
      userId: user.id,
    };
    const p = current ? await updatePayment(db, current.id, input) : await createPayment(db, input);
    refresh();
    revalidatePath("/payments/review");
    revalidatePath("/payments/installments");
    return { ok: current ? `حُفظ تعديل السند ${p.number}${p.status === "posted" ? " وأُعيد ترحيله" : ""}` : `سُجل السند ${p.number}${input.post ? " ورُحّل" : " مسودة"}`, id: p.id, label: p.number };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/**
 * شيت سندات الصرف: تعديل الخانات مباشرة، والسطور الجديدة (رقم سالب) سندات جديدة
 * (تُرحّل فور الحفظ لمن يملك الترحيل، كما في الإدخال الجماعي).
 */
export async function savePaymentSheet(payload: string): Promise<DocSheetResult> {
  const user = await requirePermission("payments", "view");
  const changes = JSON.parse(payload) as SheetChange[];
  const errors: Record<number, string> = {};
  let added = 0;
  let edited = 0;
  const id = (v: string | undefined) => (v ? Number(v) || null : null);
  const amountOf = (v: string | undefined) => cell.number((v ?? "").replace(/,/g, ""), "المبلغ") ?? 0;
  for (const ch of changes) {
    try {
      const v = ch.values;
      if (ch.id < 0) {
        if (!can(user.perms, "payments", "create")) throw new Error("لا تملك صلاحية إضافة سندات صرف");
        if (v.driverId && v.partyId) throw new Error("اختر المورد أو السائق، لا الاثنين");
        const kind = v.driverId && !v.partyId ? "custody" : "supplier";
        await createPayment(db, {
          paymentDate: cell.date(v.date, "التاريخ") ?? todayRiyadh(),
          kind,
          partyId: id(v.partyId),
          driverId: id(v.driverId),
          amount: amountOf(v.amount),
          currencyCode: v.currency === "KWD" ? "KWD" : "SAR",
          method: methodOf(cell.required(v.method, "طريقة الدفع")),
          cashAccountId: Number(cell.required(v.cashAccountId, "يُسدد من")),
          invoiceId: id(v.invoiceId),
          reference: cell.text(v.reference),
          notes: cell.text(v.notes),
          post: can(user.perms, "payments", "approve"),
          userId: user.id,
        });
        added++;
        continue;
      }
      if (!can(user.perms, "payments", "update")) throw new Error("لا تملك صلاحية تعديل سندات الصرف");
      const p = await editablePayment(ch.id, user.perms);
      const cur = await paymentToInput(db, p);
      const has = (k: string) => k in v;
      let kind = cur.kind;
      let partyId = has("partyId") ? id(v.partyId) : cur.partyId;
      let driverId = has("driverId") ? id(v.driverId) : cur.driverId;
      if (kind === "supplier" || kind === "custody") {
        // اختيار سائق دون مورد = صرف عهدة، والعكس سداد مورد
        if (has("driverId") && driverId && !has("partyId")) partyId = null;
        if (has("partyId") && partyId && !has("driverId")) driverId = null;
        if (driverId && partyId) throw new Error("اختر المورد أو السائق، لا الاثنين");
        kind = driverId ? "custody" : "supplier";
      }
      await updatePayment(db, ch.id, {
        ...cur,
        kind,
        partyId,
        driverId,
        paymentDate: has("date") ? (cell.date(v.date, "التاريخ") ?? cur.paymentDate) : cur.paymentDate,
        amount: has("amount") ? amountOf(v.amount) : cur.amount,
        currencyCode: has("currency") ? (v.currency === "KWD" ? "KWD" : "SAR") : cur.currencyCode,
        method: has("method") ? methodOf(v.method) : cur.method,
        cashAccountId: has("cashAccountId") ? Number(cell.required(v.cashAccountId, "يُسدد من")) : cur.cashAccountId,
        invoiceId: has("invoiceId") ? id(v.invoiceId) : cur.invoiceId,
        reference: has("reference") ? cell.text(v.reference) : cur.reference,
        notes: has("notes") ? cell.text(v.notes) : cur.notes,
        userId: user.id,
      });
      edited++;
    } catch (err) {
      errors[ch.id] = errorMessage(err);
    }
  }
  refresh();
  revalidatePath("/payments/review");
  const parts = [edited && `عُدّل ${edited} سند`, added && `أُضيف ${added} سند`].filter(Boolean);
  return { ok: parts.length ? parts.join(" و") : undefined, errors };
}
