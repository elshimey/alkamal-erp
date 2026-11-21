"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { approveExpense } from "@/lib/purchases";
import { approveCharges, payAccrued } from "@/lib/unpaid";
import { disburseTripCustody } from "@/lib/trip-dispatch";
import type { FormState } from "@/components/action-form";

const refresh = () => {
  revalidatePath("/payments/review");
  revalidatePath("/payments");
  revalidatePath("/expenses");
  revalidatePath("/invoices");
  revalidatePath("/waybills");
};
const cashOf = (fd: FormData) => Number(fd.get("cashAccountId")) || null;

/** اعتماد مصروف على العميل «لم يُدفع بعد»: يُقيد التزاماً وتصبح فاتورته قابلة للإصدار. */
export async function approveChargeAction(id: number): Promise<FormState> {
  const user = await requirePermission("expenses", "approve");
  try {
    await approveCharges(db, [id], user.id);
    refresh();
    return { ok: "اعتُمد المصروف وقُيد التزاماً على المستفيد؛ يمكن إصدار الفاتورة الآن" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function approveExpenseAction(id: number): Promise<FormState> {
  const user = await requirePermission("expenses", "approve");
  try {
    const entry = await approveExpense(db, id, user.id);
    refresh();
    return { ok: `اعتُمد المصروف وقُيد التزاماً بالقيد ${entry.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** سداد مصروف معتمد بسند صرف مرحّل. */
export async function payAction(kind: "charge" | "expense", id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payments", "create");
  try {
    const p = await payAccrued(db, { kind, id, cashAccountId: cashOf(fd), userId: user.id });
    refresh();
    return { ok: `سُدد بسند الصرف ${p.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** صرف عهدة رحلة أُرسلت «لم تُصرف بعد». */
export async function disburseAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payments", "create");
  try {
    const r = await disburseTripCustody(db, id, { cashAccountId: cashOf(fd), userId: user.id });
    refresh();
    return { ok: `صُرفت عهدة الرحلة ${r.number} بالسند ${r.paymentNumber}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
