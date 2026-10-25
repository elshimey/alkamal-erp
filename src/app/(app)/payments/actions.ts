"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { createPayment, deletePayment, postPayment, revertPayment } from "@/lib/purchases";
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
