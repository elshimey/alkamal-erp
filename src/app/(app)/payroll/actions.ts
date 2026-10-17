"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import {
  adjustPayrollLines,
  approvePayrollRun,
  createAdvance,
  createPayrollRun,
  deleteAdvance,
  deletePayrollRun,
  payAdvance,
  payPayrollRun,
  refreshPayrollRun,
  revertAdvance,
  revertPayrollPayment,
  revertPayrollRun,
} from "@/lib/payroll";
import type { FormState } from "@/components/action-form";

const refresh = (id?: number) => {
  revalidatePath("/payroll");
  revalidatePath("/payroll/advances");
  revalidatePath("/");
  if (id) revalidatePath(`/payroll/${id}`);
};

const done = async (fn: () => Promise<unknown>, ok: string, id?: number): Promise<FormState> => {
  try {
    await fn();
    refresh(id);
    return { ok };
  } catch (err) {
    return { error: errorMessage(err) };
  }
};

// ───────────── المسير ─────────────

export async function createRun(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payroll", "create");
  let id: number;
  try {
    id = (await createPayrollRun(db, { month: String(fd.get("month") || todayRiyadh().slice(0, 7)), userId: user.id })).id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect(`/payroll/${id}`);
}

export async function adjustLines(runId: number, rows: SheetRow[]) {
  await requirePermission("payroll", "update");
  const result = await saveSheetRows(rows, async (r) => {
    await adjustPayrollLines(db, runId, [
      {
        employeeId: Number(cell.required(r.employeeId, "الموظف")),
        absenceDays: cell.number(r.absenceDays, "أيام الغياب"),
        additions: cell.number(r.additions, "الإضافات"),
        deductions: cell.number(r.deductions, "الخصومات"),
        advanceDeduction: cell.number(r.advanceDeduction, "قسط السلفة"),
        notes: cell.text(r.notes),
      },
    ]);
  });
  refresh(runId);
  return result;
}

export async function refreshRun(id: number): Promise<FormState> {
  await requirePermission("payroll", "update");
  return done(() => refreshPayrollRun(db, id), "حُدّث المسير من بيانات الموظفين والعمولات", id);
}

export async function approveRun(id: number): Promise<FormState> {
  const user = await requirePermission("payroll", "approve");
  return done(() => approvePayrollRun(db, id, { userId: user.id }), "اعتُمد المسير ورُحّل قيد الاستحقاق", id);
}

export async function revertRun(id: number): Promise<FormState> {
  await requirePermission("payroll", "revert");
  return done(() => revertPayrollRun(db, id), "أُرجع المسير لمسودة وأُلغي قيده", id);
}

export async function payRun(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payroll", "approve");
  return done(
    () => payPayrollRun(db, id, { bankAccountId: Number(fd.get("bankAccountId")) || 0, paymentDate: String(fd.get("paymentDate") || todayRiyadh()), userId: user.id }),
    "صُرفت الرواتب ورُحّل قيد الصرف",
    id,
  );
}

export async function revertPay(id: number): Promise<FormState> {
  await requirePermission("payroll", "revert");
  return done(() => revertPayrollPayment(db, id), "أُلغي قيد الصرف", id);
}

export async function deleteRun(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payroll", "delete");
  try {
    await deletePayrollRun(db, id, { reason: String(fd.get("reason") || ""), userId: user.id });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect("/payroll");
}

// ───────────── السلف ─────────────

export async function saveAdvances(rows: SheetRow[]) {
  const user = await requirePermission("payroll", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const amount = cell.number(r.amount, "المبلغ");
    if (!amount) throw new Error("المبلغ إلزامي");
    await createAdvance(db, {
      employeeId: Number(cell.required(r.employeeId, "الموظف")),
      advanceDate: cell.date(r.date, "التاريخ") ?? todayRiyadh(),
      amount,
      installment: cell.number(r.installment, "القسط الشهري"),
      notes: cell.text(r.notes),
      userId: user.id,
    });
  });
  refresh();
  return result;
}

export async function payAdvanceAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payroll", "approve");
  return done(() => payAdvance(db, id, { cashAccountId: Number(fd.get("cashAccountId")) || 0, userId: user.id }), "صُرفت السلفة ورُحّل قيدها");
}

export async function revertAdvanceAction(id: number): Promise<FormState> {
  await requirePermission("payroll", "revert");
  return done(() => revertAdvance(db, id), "أُلغي صرف السلفة");
}

export async function deleteAdvanceAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payroll", "delete");
  return done(() => deleteAdvance(db, id, { reason: String(fd.get("reason") || "حذف"), userId: user.id }), "حُذفت السلفة");
}
