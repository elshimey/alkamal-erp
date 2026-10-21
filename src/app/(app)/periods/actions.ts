"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { postRevenueAccrual, undoRevenueAccrual } from "@/lib/accruals";
import { closeYear, openYear, reopenYear, setPeriodStatus } from "@/lib/periods";
import type { FormState } from "@/components/action-form";

const done = (ok: string): FormState => {
  revalidatePath("/periods");
  revalidatePath("/reports", "layout");
  return { ok };
};

export async function togglePeriod(id: number, status: "open" | "closed", _: FormState): Promise<FormState> {
  const user = await requirePermission("fiscal_periods", "update");
  try {
    await setPeriodStatus(db, id, status, user.id);
    return done(status === "closed" ? "أُقفل الشهر" : "فُتح الشهر");
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function addYear(year: number, _: FormState): Promise<FormState> {
  await requirePermission("fiscal_periods", "create");
  try {
    await openYear(db, year);
    return done(`فُتحت السنة ${year}`);
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function closeYearAction(year: number, _: FormState): Promise<FormState> {
  const user = await requirePermission("fiscal_periods", "approve");
  try {
    const { entry, net } = await closeYear(db, year, user.id);
    return done(`أُقفلت السنة ${year} بالقيد ${entry.number}، ونُقل ${net.toLocaleString("en")} إلى الأرباح المبقاة`);
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function reopenYearAction(year: number, _: FormState): Promise<FormState> {
  await requirePermission("fiscal_periods", "approve");
  try {
    await reopenYear(db, year);
    return done(`أُلغي إقفال السنة ${year}، وفُتح شهر ديسمبر`);
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function postAccrualAction(month: string, _: FormState): Promise<FormState> {
  const user = await requirePermission("fiscal_periods", "approve");
  try {
    const { entry, reversal, count } = await postRevenueAccrual(db, month, user.id);
    return done(`رُحّل استحقاق ${count} رحلة بالقيد ${entry.number}، وعكسه ${reversal.number}`);
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function undoAccrualAction(month: string, _: FormState): Promise<FormState> {
  await requirePermission("fiscal_periods", "approve");
  try {
    await undoRevenueAccrual(db, month);
    return done("أُلغي قيد الاستحقاق وعكسه");
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
