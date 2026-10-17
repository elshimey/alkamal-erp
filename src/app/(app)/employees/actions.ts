"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { createEmployee, updateEmployee } from "@/lib/payroll";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";

const yesNo = (v: string | undefined) => (v === "yes" ? true : v === "no" ? false : undefined);
const STATUSES = ["active", "on_leave", "terminated"] as const;

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

/** تحديث جماعي: الخلية الفارغة تُبقي القيمة الحالية كما هي. */
export async function updateEmployees(rows: SheetRow[]) {
  await requirePermission("employees", "update");
  const result = await saveSheetRows(rows, async (r) => {
    const id = Number(cell.required(r.employeeId, "الموظف"));
    const text = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);
    const n = (v: string | undefined, label: string) => cell.number(v, label) ?? undefined;
    const status = (STATUSES as readonly string[]).includes(r.status) ? (r.status as (typeof STATUSES)[number]) : undefined;
    await updateEmployee(db, id, {
      jobTitle: text(r.jobTitle),
      hireDate: cell.date(r.hireDate, "تاريخ التعيين") ?? undefined,
      basicSalary: n(r.basicSalary, "الأساسي"),
      housingAllowance: n(r.housingAllowance, "بدل السكن"),
      allowances: n(r.allowances, "بدلات أخرى"),
      isSaudi: yesNo(r.isSaudi),
      gosiSubject: yesNo(r.gosiSubject),
      bankName: text(r.bankName),
      iban: text(r.iban),
      status,
    });
  });
  revalidatePath("/employees");
  revalidatePath("/payroll");
  return result;
}
