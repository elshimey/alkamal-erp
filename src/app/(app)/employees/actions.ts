"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { createEmployee } from "@/lib/payroll";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { linkEmployeeCustody } from "@/lib/hr";
import { errorMessage } from "@/lib/errors";
import type { FormState } from "@/components/action-form";

const yesNo = (v: string | undefined) => (v === "yes" ? true : v === "no" ? false : undefined);

export async function saveEmployees(rows: SheetRow[]) {
  await requirePermission("employees", "create");
  const result = await saveSheetRows(rows, async (r) => {
    await createEmployee(db, {
      nameAr: cell.required(r.nameAr, "الاسم"),
      nationalId: cell.text(r.nationalId),
      jobTitle: cell.text(r.jobTitle),
      hireDate: cell.date(r.hireDate, "تاريخ التعيين"),
      basicSalary: cell.number(r.basicSalary, "الأساسي") ?? 0,
      housingAllowance: cell.number(r.housingAllowance, "بدل السكن") ?? 0,
      allowances: cell.number(r.allowances, "بدلات أخرى") ?? 0,
      isSaudi: yesNo(r.isSaudi) ?? false,
      gosiSubject: yesNo(r.gosiSubject) ?? true,
      bankName: cell.text(r.bankName),
      iban: cell.text(r.iban),
    });
  });
  revalidatePath("/employees");
  return result;
}

/** ربط موظف المكتب بحساب عهدته: حساب موجود تحت 1105 أو فتح حساب جديد إن لم يُختر. */
export async function linkCustody(employeeId: number, _: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("employees", "update");
  try {
    await linkEmployeeCustody(db, employeeId, Number(fd.get("accountId")) || null);
    revalidatePath("/employees");
    revalidatePath("/expenses");
    return { ok: "رُبط حساب العهدة" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
