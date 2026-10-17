"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { createReceipt, deleteReceipt, postReceipt, revertReceipt } from "@/lib/invoices";
import { PAYMENT_METHODS } from "@/data/sales";
import type { FormState } from "@/components/action-form";

const refresh = () => {
  revalidatePath("/receipts");
  revalidatePath("/invoices");
  revalidatePath("/");
};

export async function saveReceipts(rows: SheetRow[]) {
  const user = await requirePermission("receipts", "create");
  // من يملك الاعتماد يُرحَّل سنده مباشرة، وغيره يبقى مسودة للمراجعة
  const post = can(user.perms, "receipts", "approve");
  const result = await saveSheetRows(rows, async (r) => {
    const amount = cell.number(r.amount, "المبلغ");
    if (!amount) throw new Error("المبلغ إلزامي");
    const method = cell.required(r.method, "طريقة الدفع");
    if (!(method in PAYMENT_METHODS)) throw new Error("طريقة الدفع غير معروفة");
    await createReceipt(db, {
      receiptDate: cell.date(r.date, "التاريخ") ?? cell.required("", "التاريخ"),
      customerId: Number(cell.required(r.customerId, "العميل")),
      amount,
      currencyCode: r.currency === "KWD" ? "KWD" : "SAR",
      exchangeRate: cell.number(r.rate, "سعر الصرف"),
      method: method as keyof typeof PAYMENT_METHODS,
      cashAccountId: Number(cell.required(r.cashAccountId, "الصندوق / البنك")),
      collector: cell.text(r.collector),
      reference: cell.text(r.reference),
      invoiceId: r.invoiceId ? Number(r.invoiceId) : null,
      notes: cell.text(r.notes),
      post,
      userId: user.id,
    });
  });
  refresh();
  return result;
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
