"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { once } from "@/lib/once";
import { applyAdvance, createReceipt, customerCredit, deleteReceipt, openInvoices, postReceipt, revertReceipt, type ReceiptKind } from "@/lib/receipts";
import { PAYMENT_METHODS } from "@/data/sales";
import type { FormState } from "@/components/action-form";

const refresh = () => {
  revalidatePath("/receipts");
  revalidatePath("/invoices");
  revalidatePath("/customers");
  revalidatePath("/");
};

/** فواتير العميل المفتوحة ورصيده الدائن لنموذج السند. */
export async function customerOpenItems(customerId: number, currencyCode: string) {
  await requirePermission("receipts", "create");
  const [invoices, credit] = await Promise.all([openInvoices(db, customerId, currencyCode), customerCredit(db, customerId)]);
  return { invoices, credit };
}

export interface ReceiptPayload {
  kind: ReceiptKind;
  customerId: number;
  cashAccountId: number;
  currencyCode: string;
  amount: number;
  receiptDate: string;
  method: keyof typeof PAYMENT_METHODS;
  notes?: string;
  reference?: string;
  collector?: string;
  allocations: { invoiceId: number; amount: number }[];
  adjustments: { accountId: number; amount: number; description: string }[];
  /** معرّف الإرسال من النموذج لمنع تسجيل السند مرتين */
  op?: string;
}

export async function saveReceipt(p: ReceiptPayload): Promise<{ id?: number; error?: string; posted?: boolean }> {
  const user = await requirePermission("receipts", "create");
  // من يملك الاعتماد يُرحَّل سنده مباشرة، وغيره يبقى مسودة بتوزيعه حتى يُعتمد
  const post = can(user.perms, "receipts", "approve");
  try {
    if (!(p.method in PAYMENT_METHODS)) throw new Error("طريقة الدفع غير معروفة");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.receiptDate)) throw new Error("التاريخ مطلوب");
    const r = await once(db, p.op, async () => {
      const row = await createReceipt(db, {
        kind: p.kind,
        receiptDate: p.receiptDate,
        customerId: Number(p.customerId),
        amount: Number(p.amount),
        currencyCode: p.currencyCode,
        method: p.method,
        cashAccountId: Number(p.cashAccountId),
        notes: p.notes?.trim() || null,
        reference: p.reference?.trim() || null,
        collector: p.collector?.trim() || null,
        allocations: p.allocations.map((a) => ({ invoiceId: Number(a.invoiceId), amount: Number(a.amount) })),
        adjustments: p.adjustments.map((a) => ({ accountId: Number(a.accountId), amount: Number(a.amount), description: a.description })),
        post,
        userId: user.id,
      });
      return { id: row.id };
    });
    refresh();
    return { id: r.id, posted: post };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function applyAdvanceAction(receiptId: number, allocations: { invoiceId: number; amount: number }[], date: string): Promise<{ ok?: string; error?: string }> {
  const user = await requirePermission("receipts", "create");
  try {
    const res = await applyAdvance(db, receiptId, allocations, { date, userId: user.id });
    refresh();
    return { ok: `طُبق ${res.applied.toLocaleString("en")} بالقيد ${res.entry.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function post(id: number): Promise<FormState> {
  const user = await requirePermission("receipts", "approve");
  try {
    const { entry, unallocated } = await postReceipt(db, id, { userId: user.id });
    refresh();
    return { ok: `رُحّل القيد ${entry.number}${unallocated > 0 ? ` (رصيد غير مخصص ${unallocated.toLocaleString("en")})` : ""}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revert(id: number): Promise<FormState> {
  await requirePermission("receipts", "revert");
  try {
    await revertReceipt(db, id);
    refresh();
    return { ok: "أُرجع السند لمسودة" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function remove(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("receipts", "delete");
  try {
    await deleteReceipt(db, id, { reason: String(fd.get("reason") || "حذف من الشاشة"), userId: user.id });
    refresh();
    return { ok: "حُذف السند" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
