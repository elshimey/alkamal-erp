"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { createViolation, deleteViolation, payViolations, revertViolationPayment } from "@/lib/violations";
import { todayRiyadh } from "@/lib/dates";
import type { FormState } from "@/components/action-form";

const refresh = () => {
  revalidatePath("/violations");
  revalidatePath("/payroll");
  revalidatePath("/");
};

export async function saveViolations(rows: SheetRow[]) {
  const user = await requirePermission("violations", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const amount = cell.number(r.amount, "المبلغ");
    if (!amount) throw new Error("المبلغ إلزامي");
    const chargeTo = cell.required(r.chargeTo, "على من");
    if (chargeTo !== "driver" && chargeTo !== "company") throw new Error("على من: السائق أو الشركة");
    await createViolation(db, {
      violationDate: cell.date(r.date, "التاريخ") ?? cell.required("", "التاريخ"),
      vehicleId: Number(cell.required(r.vehicleId, "المركبة")),
      driverId: r.driverId ? Number(r.driverId) : null,
      reference: cell.text(r.reference),
      violationType: cell.required(r.type, "نوع المخالفة"),
      location: cell.text(r.location),
      amount,
      chargeTo,
      notes: cell.text(r.notes),
      userId: user.id,
    });
  });
  refresh();
  return result;
}

export async function pay(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("violations", "approve");
  try {
    const ids = fd.getAll("ids").map(Number).filter(Boolean);
    const entry = await payViolations(db, ids, {
      paymentDate: String(fd.get("paymentDate") || "") || todayRiyadh(),
      cashAccountId: Number(fd.get("cashAccountId")),
      userId: user.id,
    });
    refresh();
    return { ok: `سُددت ${ids.length} مخالفة بالقيد ${entry.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revertPayment(id: number): Promise<FormState> {
  await requirePermission("violations", "revert");
  try {
    const n = await revertViolationPayment(db, id);
    refresh();
    return { ok: `أُلغي السداد عن ${n} مخالفة` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function remove(id: number): Promise<FormState> {
  const user = await requirePermission("violations", "delete");
  try {
    await deleteViolation(db, id, { reason: "حذف من الشاشة", userId: user.id });
    refresh();
    return { ok: "حُذفت المخالفة وقيدها" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
