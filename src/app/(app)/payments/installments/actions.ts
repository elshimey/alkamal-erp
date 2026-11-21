"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { once } from "@/lib/once";
import { todayRiyadh } from "@/lib/dates";
import { parseAmount, type ScheduleRow } from "@/lib/installment-schedule";
import { createInstallmentPlan, deleteInstallmentPlan, payInstallment, payoffPlan, reclassifyCurrentPortion, undoPayoff, undoReclassification, updateInstallment } from "@/lib/installments";
import type { FormState } from "@/components/action-form";
import type { PanelResult } from "@/components/record-panel";

const refresh = (planId?: number) => {
  revalidatePath("/payments/installments");
  if (planId) revalidatePath(`/payments/installments/${planId}`);
  revalidatePath("/payments");
};
const get = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const idOf = (fd: FormData, k: string) => Number(get(fd, k)) || null;
const amountOf = (fd: FormData, k: string) => {
  const v = get(fd, k);
  if (!v) return null;
  const n = parseAmount(v);
  if (n == null) throw new Error("المبلغ ليس رقماً");
  return n;
};

/** إنشاء جدول أقساط: السطور مولّدة أو ملصوقة من Excel في النافذة، وكل سطر قابل للتعديل قبل الحفظ. */
export async function savePlanAction(fd: FormData): Promise<PanelResult> {
  const user = await requirePermission("payments", "create");
  try {
    let rows: ScheduleRow[];
    try {
      rows = JSON.parse(get(fd, "rows") || "[]");
    } catch {
      throw new Error("سطور الجدول غير صالحة");
    }
    if (!Array.isArray(rows) || !rows.length) throw new Error("ولّد الأقساط أو الصق جدول البنك أولاً");
    const accountId = idOf(fd, "accountId");
    if (!accountId) throw new Error("اختر حساب الدائن من الشجرة");
    const plan = await once(db, get(fd, "_op"), () =>
      createInstallmentPlan(db, {
        name: get(fd, "name"),
        accountId,
        partyId: idOf(fd, "partyId"),
        vehicleId: idOf(fd, "vehicleId"),
        notes: get(fd, "notes"),
        rows: rows.map((r) => ({ dueDate: String(r.dueDate), principal: Number(r.principal), cost: Number(r.cost) })),
        userId: user.id,
      }),
    );
    refresh(plan.id);
    return { ok: `حُفظ جدول «${plan.name}» بـ ${rows.length} قسط`, id: plan.id, label: plan.name };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** سداد قسط بسند صرف مرحّل؛ المبلغ الأقل من القسط يبقى باقيه على القسط نفسه. */
export async function payInstallmentAction(installmentId: number, planId: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payments", "create");
  try {
    const p = await once(db, get(fd, "_op"), () =>
      payInstallment(db, { installmentId, amount: amountOf(fd, "amount"), cashAccountId: idOf(fd, "cashAccountId"), date: get(fd, "date") || todayRiyadh(), userId: user.id }),
    );
    refresh(planId);
    return { ok: p.remaining > 0 ? `سُدد بسند الصرف ${p.number}، وباقي القسط ${p.remaining.toFixed(2)}` : `سُدد القسط بسند الصرف ${p.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** السداد المبكر بالمبلغ الذي يطلبه الدائن. */
export async function payoffAction(planId: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payments", "create");
  try {
    const amount = amountOf(fd, "amount");
    if (!amount) throw new Error("اكتب المبلغ الذي يطلبه الدائن للسداد المبكر");
    const r = await once(db, get(fd, "_op"), () => payoffPlan(db, { planId, amount, cashAccountId: idOf(fd, "cashAccountId"), date: get(fd, "date") || todayRiyadh(), userId: user.id }));
    refresh(planId);
    const diff = Math.abs(r.diff) >= 0.005 ? `، والفرق ${Math.abs(r.diff).toFixed(2)} ${r.diff > 0 ? "زيادة" : "خصم"} على تكاليف التمويل` : "";
    return { ok: `سُدد الجدول مبكراً بسند الصرف ${r.payment.number} وأُقفل ${r.cancelled} قسط${diff}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** أزرار صفحة الجدول: إلغاء السداد المبكر، وإعادة التصنيف وإلغاؤها، والحذف. */
export async function planAction(planId: number, _: FormState, fd: FormData): Promise<FormState> {
  const op = get(fd, "op");
  const user = await requirePermission("payments", op === "delete" ? "delete" : "create");
  try {
    if (op === "undo_payoff") {
      await undoPayoff(db, planId, { userId: user.id });
      refresh(planId);
      return { ok: "أُلغي السداد المبكر وعادت الأقساط مستحقة" };
    }
    if (op === "reclass") {
      const r = await once(db, get(fd, "_op"), () => reclassifyCurrentPortion(db, { planId, date: get(fd, "date") || todayRiyadh(), targetAccountId: idOf(fd, "targetAccountId"), userId: user.id }));
      refresh(planId);
      return { ok: `أُعيد تصنيف ${r.amount.toFixed(2)} للقروض قصيرة الأجل بالقيد ${r.entry.number}، وعكسه ${r.reversal.number} في اليوم التالي` };
    }
    if (op.startsWith("undo_reclass:")) {
      await undoReclassification(db, planId, op.slice("undo_reclass:".length));
      refresh(planId);
      return { ok: "حُذف قيد إعادة التصنيف وعكسه" };
    }
    if (op !== "delete") return { error: "عملية غير معروفة" };
    await deleteInstallmentPlan(db, planId, { reason: get(fd, "reason"), userId: user.id });
    refresh();
  } catch (err) {
    return { error: errorMessage(err) };
  }
  redirect("/payments/installments");
}

/** تعديل قسط لم يُسدد منه شيء. */
export async function updateInstallmentAction(id: number, planId: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payments", "create");
  try {
    await updateInstallment(db, { id, dueDate: get(fd, "dueDate"), principal: amountOf(fd, "principal") ?? 0, cost: amountOf(fd, "cost") ?? 0, userId: user.id });
    refresh(planId);
    return { ok: "عُدّل القسط" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}
