"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { approveExpense, createExpense, deleteExpense, rejectExpense, revertExpense } from "@/lib/purchases";
import type { FormState } from "@/components/action-form";

const refresh = () => {
  revalidatePath("/expenses");
  revalidatePath("/");
};

export async function saveExpenses(rows: SheetRow[]) {
  const user = await requirePermission("expenses", "create");
  const approve = can(user.perms, "expenses", "approve");
  const result = await saveSheetRows(rows, async (r) => {
    const amount = cell.number(r.amount, "المبلغ");
    if (!amount) throw new Error("المبلغ إلزامي");
    const payer = cell.required(r.payer, "الدافع");
    if (payer !== "driver_custody" && payer !== "cash") throw new Error("الدافع: عهدة السائق أو صندوق / بنك");
    await createExpense(db, {
      expenseDate: cell.date(r.date, "التاريخ") ?? todayRiyadh(),
      payer,
      driverId: r.driverId ? Number(r.driverId) : null,
      cashAccountId: r.cashAccountId ? Number(r.cashAccountId) : null,
      accountId: Number(cell.required(r.accountId, "نوع المصروف")),
      vehicleId: r.vehicleId ? Number(r.vehicleId) : null,
      waybillId: r.waybillId ? Number(r.waybillId) : null,
      description: cell.text(r.description) ?? "",
      amount,
      vatAmount: cell.number(r.vat, "الضريبة") ?? 0,
      vendorName: cell.text(r.vendor),
      reference: cell.text(r.reference),
      approve,
      userId: user.id,
    });
  });
  refresh();
  return result;
}

export async function approve(id: number): Promise<FormState> {
  const user = await requirePermission("expenses", "approve");
  try {
    const entry = await approveExpense(db, id, user.id);
    refresh();
    return { ok: `اعتُمد ورُحّل القيد ${entry.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function approveMany(ids: number[]): Promise<FormState> {
  const user = await requirePermission("expenses", "approve");
  const errors: string[] = [];
  let ok = 0;
  for (const id of ids) {
    try {
      await approveExpense(db, id, user.id);
      ok++;
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  refresh();
  return { ok: ok ? `اعتُمد ${ok} مصروف` : undefined, error: errors.length ? errors.join("\n") : undefined };
}

export async function reject(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("expenses", "approve");
  try {
    await rejectExpense(db, id, String(fd.get("reason") || ""));
    refresh();
    return { ok: "رُفض المصروف" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revert(id: number): Promise<FormState> {
  await requirePermission("expenses", "revert");
  try {
    await revertExpense(db, id);
    refresh();
    return { ok: "أُعيد المصروف لبانتظار الاعتماد" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function remove(id: number): Promise<FormState> {
  const user = await requirePermission("expenses", "delete");
  try {
    await deleteExpense(db, id, { reason: "حذف من الشاشة", userId: user.id });
    refresh();
    return { ok: "حُذف المصروف" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
