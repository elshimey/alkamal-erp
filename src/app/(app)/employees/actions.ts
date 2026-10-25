"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { createEmployee } from "@/lib/payroll";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";

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
