"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { approveExpense, approveExpenseWith, createExpense, deleteExpense, expenseToInput, rejectExpense, revertExpense, updateExpense, type ExpenseInput } from "@/lib/purchases";
import type { DocSheetResult, SheetChange } from "@/components/doc-sheet";
import type { FormState } from "@/components/action-form";
import type { PanelResult } from "@/components/record-panel";
import { saveDataUrl } from "@/lib/attachments";

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
    if (payer !== "driver_custody" && payer !== "cash" && payer !== "unpaid") throw new Error("الدافع: عهدة السائق أو الشركة (صندوق / بنك / عهدة موظف) أو لم يُدفع بعد");
    await createExpense(db, {
      expenseDate: cell.date(r.date, "التاريخ") ?? todayRiyadh(),
      payer,
      driverId: r.driverId ? Number(r.driverId) : null,
      cashAccountId: r.cashAccountId ? Number(r.cashAccountId) : null,
      partyId: r.partyId ? Number(r.partyId) : null,
      accountId: Number(cell.required(r.accountId, "نوع المصروف")),
      vehicleId: r.vehicleId ? Number(r.vehicleId) : null,
      waybillId: r.waybillId ? Number(r.waybillId) : null,
      description: cell.text(r.description) ?? "",
      amount,
      vatAmount: cell.number(r.vat, "الضريبة") ?? 0,
      vendorName: cell.text(r.vendor),
      reference: cell.text(r.reference),
      billToCustomer: r.billTo === "customer" || r.billTo === "نعم، يُفوتر",
      approve,
      userId: user.id,
    });
  });
  refresh();
  return result;
}

/** المعتمد يُعاد قيده عند التعديل، فيحتاج صلاحية الإرجاع مع التعديل. */
async function editableExpense(id: number, perms: Parameters<typeof can>[0]) {
  const [e] = await db.select().from(s.expenses).where(eq(s.expenses.id, id));
  if (!e) throw new Error("المصروف غير موجود");
  if (e.status === "approved" && !can(perms, "expenses", "revert")) throw new Error(`المصروف ${e.number} معتمد؛ تعديله يعيد قيده ويحتاج صلاحية الإرجاع`);
  return e;
}

/** نافذة المصروف الواحد (جديد أو تعديل): نفس createExpense / updateExpense الذي يستخدمه الشيت، مع صورة الإيصال ومركز التكلفة. */
export async function saveExpenseAction(editId: number | null, data: FormData): Promise<PanelResult> {
  const user = await requirePermission("expenses", editId ? "update" : "create");
  const get = (k: string) => String(data.get(k) ?? "").trim();
  const num = (k: string) => Number(get(k).replace(/,/g, "")) || 0;
  const id = (k: string) => Number(get(k)) || null;
  try {
    const payer = get("payer");
    if (payer !== "driver_custody" && payer !== "cash" && payer !== "unpaid") throw new Error("اختر من دفع: الشركة أو عهدة السائق أو لم يُدفع بعد");
    if (!get("accountId")) throw new Error("اختر نوع المصروف");
    if (editId) await editableExpense(editId, user.perms);
    const e = await db.transaction(async (tx) => {
      const input: ExpenseInput = {
        expenseDate: get("date") || todayRiyadh(),
        payer,
        driverId: id("driverId"),
        cashAccountId: payer === "cash" ? id("cashAccountId") : null,
        partyId: payer === "unpaid" ? id("partyId") : null,
        accountId: Number(get("accountId")),
        vehicleId: id("vehicleId"),
        costCenterId: id("costCenterId"),
        waybillId: id("waybillId"),
        description: get("description"),
        amount: num("amount"),
        vatAmount: num("vat"),
        vendorName: get("vendor") || null,
        reference: get("reference") || null,
        billToCustomer: get("billToCustomer") === "1",
        approve: can(user.perms, "expenses", "approve"),
        userId: user.id,
      };
      const row = editId ? await updateExpense(tx, editId, input) : await createExpense(tx, input);
      await saveDataUrl(tx, { entity: "expenses", entityId: row.id, kind: "expense_receipt", dataUrl: get("file"), userId: user.id });
      return row;
    });
    refresh();
    revalidatePath("/payments/review");
    return { ok: editId ? `حُفظ تعديل المصروف ${e.number}${e.status === "approved" ? " وأُعيد ترحيل قيده" : ""}` : `سُجل المصروف ${e.number}`, id: e.id, label: e.number };
  } catch (err) {
    return { error: errorMessage(err) };
  }
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

/** اعتماد مصروف السائق بعد مراجعته: الدافع الفعلي والحساب والضريبة والمورد. */
export async function approveReviewed(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("expenses", "approve");
  try {
    const vat = String(fd.get("vat") ?? "").replace(/,/g, "").trim();
    const entry = await approveExpenseWith(db, id, {
      payer: fd.get("payer") === "cash" ? "cash" : "driver_custody",
      cashAccountId: Number(fd.get("cashAccountId")) || null,
      accountId: Number(fd.get("accountId")) || null,
      vatAmount: vat ? Number(vat) : 0,
      vendorName: String(fd.get("vendor") ?? ""),
      billToCustomer: fd.get("billToCustomer") === "1",
      userId: user.id,
    });
    refresh();
    revalidatePath("/driver/expenses");
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
    revalidatePath("/driver/expenses");
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

const SHEET_PAYERS: Record<string, ExpenseInput["payer"]> = { driver_custody: "driver_custody", cash: "cash", unpaid: "unpaid" };

/**
 * شيت المصروفات (عرض «شيت»): تعديل الخانات مباشرة، والسطور الجديدة (رقم سالب) تُضاف مصروفات جديدة.
 * كل سطر يمر على updateExpense أو createExpense نفسها فلا يختلف القيد عن النافذة.
 */
export async function saveExpenseSheet(payload: string): Promise<DocSheetResult> {
  const user = await requirePermission("expenses", "view");
  const changes = JSON.parse(payload) as SheetChange[];
  const errors: Record<number, string> = {};
  let added = 0;
  let edited = 0;
  const id = (v: string | undefined) => (v ? Number(v) || null : null);
  for (const ch of changes) {
    try {
      const v = ch.values;
      const amountOf = (raw: string | undefined, label: string) => (raw === undefined ? undefined : (cell.number(raw.replace(/,/g, ""), label) ?? 0));
      if (ch.id < 0) {
        if (!can(user.perms, "expenses", "create")) throw new Error("لا تملك صلاحية إضافة مصروفات");
        const payer = SHEET_PAYERS[v.payer ?? ""];
        if (!payer) throw new Error("اختر الدافع: الشركة أو عهدة السائق أو لم يُدفع بعد");
        await createExpense(db, {
          expenseDate: cell.date(v.date, "التاريخ") ?? todayRiyadh(),
          payer,
          driverId: id(v.driverId),
          cashAccountId: id(v.cashAccountId),
          partyId: id(v.partyId),
          accountId: Number(cell.required(v.accountId, "نوع المصروف")),
          vehicleId: id(v.vehicleId),
          waybillId: id(v.waybillId),
          description: cell.text(v.description) ?? "",
          amount: amountOf(v.amount, "المبلغ") ?? 0,
          vatAmount: amountOf(v.vat, "الضريبة") ?? 0,
          vendorName: cell.text(v.vendor),
          reference: cell.text(v.reference),
          approve: can(user.perms, "expenses", "approve"),
          userId: user.id,
        });
        added++;
        continue;
      }
      if (!can(user.perms, "expenses", "update")) throw new Error("لا تملك صلاحية تعديل المصروفات");
      const e = await editableExpense(ch.id, user.perms);
      const cur = expenseToInput(e);
      const has = (k: string) => k in v;
      const payer = has("payer") ? SHEET_PAYERS[v.payer] : cur.payer;
      if (!payer) throw new Error("اختر الدافع: الشركة أو عهدة السائق أو لم يُدفع بعد");
      await updateExpense(db, ch.id, {
        ...cur,
        expenseDate: has("date") ? (cell.date(v.date, "التاريخ") ?? cur.expenseDate) : cur.expenseDate,
        payer,
        accountId: has("accountId") ? Number(cell.required(v.accountId, "نوع المصروف")) : cur.accountId,
        description: has("description") ? (cell.text(v.description) ?? "") : cur.description,
        vehicleId: has("vehicleId") ? id(v.vehicleId) : cur.vehicleId,
        driverId: has("driverId") ? id(v.driverId) : cur.driverId,
        cashAccountId: has("cashAccountId") ? id(v.cashAccountId) : cur.cashAccountId,
        partyId: has("partyId") ? id(v.partyId) : cur.partyId,
        waybillId: has("waybillId") ? id(v.waybillId) : cur.waybillId,
        amount: amountOf(v.amount, "المبلغ") ?? cur.amount,
        vatAmount: amountOf(v.vat, "الضريبة") ?? cur.vatAmount,
        vendorName: has("vendor") ? cell.text(v.vendor) : cur.vendorName,
        reference: has("reference") ? cell.text(v.reference) : cur.reference,
        userId: user.id,
      });
      edited++;
    } catch (err) {
      errors[ch.id] = errorMessage(err);
    }
  }
  refresh();
  revalidatePath("/payments/review");
  const parts = [edited && `عُدّل ${edited} مصروف`, added && `أُضيف ${added} مصروف`].filter(Boolean);
  return { ok: parts.length ? parts.join(" و") : undefined, errors };
}
