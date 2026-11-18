import { and, asc, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx } from "@/lib/ledger";
import { todayRiyadh } from "@/lib/dates";
import { EDITABLE, insertExpenseTx, lockWaybill, waybillAccountIds, waybillPostingDims, type ExpenseInput } from "@/lib/waybills";
import { waybillExpenseLines } from "@/lib/waybill-posting";
import { attachChargeToDraftInvoiceTx, detachChargeTx } from "@/lib/invoices";

// مصاريف الرحلة في أي وقت: قبل الاعتماد تُقيد مع قيد الشحنة، وبعده بقيد مستقل فوراً،
// وما يكون على العميل يُقيد على 1114 ويدخل مسودة فاتورة الشحنة إن وُجدت.
// بعد إصدار الفاتورة يُحمَّل المصروف بإشعار مدين مربوط بها (القرار السابق).

/** قيد مستقل لمصروف أُضيف بعد اعتماد الشحنة، بتاريخ اليوم (أو تاريخ الشحنة إن كان أحدث). */
async function postChargeTx(tx: Tx, w: typeof s.waybills.$inferSelect, rowId: number, userId?: number) {
  const [row] = await tx
    .select({ e: s.waybillExpenses, label: s.chargeTypes.nameAr, costAccountId: s.chargeTypes.costAccountId })
    .from(s.waybillExpenses)
    .innerJoin(s.chargeTypes, eq(s.chargeTypes.id, s.waybillExpenses.chargeTypeId))
    .where(eq(s.waybillExpenses.id, rowId));
  const dims = await waybillPostingDims(tx, w);
  const lines = waybillExpenseLines(
    { id: w.id, number: w.number, costCenterId: dims.costCenterId, driverId: w.driverId, driverCustodyAccountId: dims.custodyId },
    [
      {
        costAccountId: row.costAccountId,
        label: row.label,
        payer: row.e.payer,
        partyId: row.e.partyId,
        cashAccountId: row.e.cashAccountId,
        billToCustomer: row.e.billTo === "customer",
        amount: Number(row.e.amount),
        currencyCode: row.e.currencyCode,
        exchangeRate: Number(row.e.exchangeRate),
      },
    ],
    await waybillAccountIds(tx),
  );
  const today = todayRiyadh();
  const entry = await createJournalEntryTx(tx, {
    entryDate: today > w.waybillDate ? today : w.waybillDate,
    description: `مصروف الشحنة ${w.number}: ${row.label}`,
    // مصدر مستقل لكل مصروف (للشحنة قيد واحد عند الاعتماد)
    source: { type: "waybill_charge", id: rowId },
    lines,
    post: true,
    userId,
  });
  await tx.update(s.waybillExpenses).set({ journalEntryId: entry.id }).where(eq(s.waybillExpenses.id, rowId));
  return entry;
}

/** يضيف مصروفاً للشحنة داخل معاملة قائمة (قبل الاعتماد مع قيدها، وبعده بقيد مستقل ويدخل مسودة فاتورتها). */
export async function addWaybillChargeTx(tx: Tx, waybillId: number, e: ExpenseInput, userId?: number) {
  const w = await lockWaybill(tx, waybillId);
  if (w.status === "invoiced") throw new Error(`الشحنة ${w.number} مفوترة؛ حمّل المصروف على العميل بإشعار مدين مربوط بفاتورتها`);
  if (w.status === "rejected" && e.billTo === "customer") throw new Error(`الشحنة ${w.number} مرفوضة؛ لا يُحمَّل عليها مصروف للعميل`);
  const row = await insertExpenseTx(tx, w, e);
  if (EDITABLE.includes(w.status)) return { row, invoice: null };
  await postChargeTx(tx, w, row.id, userId);
  const invoice = await attachChargeToDraftInvoiceTx(tx, row.id);
  return { row, invoice };
}

/** يضيف مصروفاً للشحنة في أي مرحلة قبل إصدار فاتورتها. */
export async function addWaybillCharge(db: Db, waybillId: number, e: ExpenseInput, userId?: number) {
  return db.transaction((tx) => addWaybillChargeTx(tx, waybillId, e, userId));
}

/** عدة مصاريف على العميل معاً (من نافذة الشحنة أو مسودة الفاتورة): كلها أو لا شيء. */
export async function addCustomerCharges(db: Db | Tx, items: { waybillId: number; charge: ExpenseInput }[], userId?: number) {
  if (!items.length) return [];
  const run = async (tx: Tx) => {
    const out = [];
    for (const it of items) out.push(await addWaybillChargeTx(tx, it.waybillId, { ...it.charge, billTo: "customer" }, userId));
    return out;
  };
  // داخل معاملة قائمة تصبح نقطة حفظ، فالخطأ يُرجع المصاريف وحدها أو المعاملة كلها حسب المستدعي
  return (db as Db).transaction(run);
}

/** يحذف مصروف الشحنة: يخرج من مسودة الفاتورة، ويُحذف قيده المستقل إن وُجد. */
export async function removeWaybillCharge(db: Db, waybillId: number, itemId: number) {
  return db.transaction(async (tx) => {
    const w = await lockWaybill(tx, waybillId);
    const [e] = await tx.select().from(s.waybillExpenses).where(and(eq(s.waybillExpenses.id, itemId), eq(s.waybillExpenses.waybillId, waybillId)));
    if (!e) return;
    if (e.sourceExpenseId) throw new Error("هذا المصروف من مصروفات السائق؛ يُرجَع من شاشة المصروفات");
    // مصروف قُيد مع اعتماد الشحنة لا يُحذف إلا بإرجاعها
    if (!e.journalEntryId && !EDITABLE.includes(w.status)) throw new Error(`قُيد المصروف مع اعتماد الشحنة ${w.number}؛ أرجعها لمسودة أولاً`);
    await detachChargeTx(tx, e.id);
    await tx.delete(s.waybillExpenses).where(eq(s.waybillExpenses.id, e.id));
    if (e.journalEntryId) await deleteEntryTx(tx, e.journalEntryId);
  });
}

/** نوع مصروف عام لمصروفات السائق المحمّلة على العميل (يُنشأ عند أول حاجة). */
async function genericChargeType(tx: Tx) {
  const name = "مصروف رحلة على العميل";
  const [row] = await tx.select({ id: s.chargeTypes.id }).from(s.chargeTypes).where(eq(s.chargeTypes.nameAr, name));
  if (row) return row.id;
  const [created] = await tx.insert(s.chargeTypes).values({ nameAr: name }).returning({ id: s.chargeTypes.id });
  return created.id;
}

/**
 * مصروف السائق (أو المصروف المباشر) المعتمد على العميل: قيده عليه هو، ويُسجَّل في مصاريف الشحنة
 * ليظهر سطراً مستقلاً في فاتورتها.
 */
export async function linkExpenseToWaybillTx(tx: Tx, expense: typeof s.expenses.$inferSelect, journalEntryId: number) {
  if (!expense.waybillId) throw new Error(`المصروف ${expense.number}: اختر الشحنة ليُحمَّل على عميلها`);
  const w = await lockWaybill(tx, expense.waybillId);
  if (w.status === "invoiced") throw new Error(`الشحنة ${w.number} مفوترة؛ حمّل المصروف بإشعار مدين مربوط بفاتورتها`);
  const row = await insertExpenseTx(tx, w, {
    chargeTypeId: await genericChargeType(tx),
    amount: Number(expense.amount),
    currencyCode: expense.currencyCode,
    exchangeRate: Number(expense.exchangeRate),
    billTo: "customer",
    // الدفع الفعلي مسجّل في قيد المصروف؛ هنا للعرض فقط
    payer: expense.payer === "cash" ? "cash" : "driver_custody",
    cashAccountId: expense.cashAccountId,
    note: `${expense.number} – ${expense.description}`,
    journalEntryId,
    sourceExpenseId: expense.id,
  });
  await attachChargeToDraftInvoiceTx(tx, row.id);
  return row;
}

/** عند إرجاع المصروف: يخرج من الشحنة وفاتورتها المسودة. */
export async function unlinkExpenseTx(tx: Tx, expenseId: number) {
  const [row] = await tx.select().from(s.waybillExpenses).where(eq(s.waybillExpenses.sourceExpenseId, expenseId));
  if (!row) return;
  await detachChargeTx(tx, row.id);
  await tx.delete(s.waybillExpenses).where(eq(s.waybillExpenses.id, row.id));
}

/** متابعة 1114: ما دُفع على العملاء ولم يدخل فاتورة صادرة بعد. */
export async function unbilledCharges(db: Db | Tx) {
  return db
    .select({
      id: s.waybillExpenses.id,
      waybillId: s.waybills.id,
      // مصروف الفاتورة المباشرة دون شحنة: رقم الفاتورة وتاريخها مكان الشحنة
      waybill: sql<string>`coalesce(${s.waybills.number}, ${s.salesInvoices.number})`,
      waybillDate: sql<string>`coalesce(${s.waybills.waybillDate}, ${s.salesInvoices.invoiceDate})`,
      status: s.waybills.status,
      invoiceId: s.waybillExpenses.invoiceId,
      customer: s.parties.nameAr,
      type: s.chargeTypes.nameAr,
      note: s.waybillExpenses.note,
      amount: s.waybillExpenses.amount,
      currencyCode: s.waybillExpenses.currencyCode,
      base: sql<string>`round(${s.waybillExpenses.amount} * ${s.waybillExpenses.exchangeRate}, 2)`,
      payer: s.waybillExpenses.payer,
      draftInvoice: sql<string | null>`(select i.number from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id where l.waybill_expense_id = ${s.waybillExpenses.id})`,
    })
    .from(s.waybillExpenses)
    .leftJoin(s.waybills, eq(s.waybills.id, s.waybillExpenses.waybillId))
    .leftJoin(s.salesInvoices, eq(s.salesInvoices.id, s.waybillExpenses.invoiceId))
    .innerJoin(s.parties, eq(s.parties.id, sql`coalesce(${s.waybills.customerId}, ${s.salesInvoices.customerId})`))
    .innerJoin(s.chargeTypes, eq(s.chargeTypes.id, s.waybillExpenses.chargeTypeId))
    .where(
      and(
        eq(s.waybillExpenses.billTo, "customer"),
        sql`not exists (select 1 from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id where l.waybill_expense_id = ${s.waybillExpenses.id} and i.status = 'issued')`,
      ),
    )
    .orderBy(asc(s.parties.nameAr), sql`coalesce(${s.waybills.waybillDate}, ${s.salesInvoices.invoiceDate})`);
}


/**
 * يقرأ صفوف «مصاريف على العميل» من النافذة ويتحقق منها قبل أي حفظ (الصف الفارغ يُتجاهل).
 * في الفاتورة المباشرة (invoiceLevel) يكون المصروف على الفاتورة نفسها: waybillId = 0.
 */
export function parseChargeRows(json: string, fallbackWaybillId?: number, opts?: { invoiceLevel?: boolean }): { waybillId: number; charge: ExpenseInput }[] {
  let rows: Record<string, string>[];
  try {
    rows = JSON.parse(json || "[]");
  } catch {
    return [];
  }
  const out: { waybillId: number; charge: ExpenseInput }[] = [];
  rows.forEach((r, i) => {
    const amount = Number(String(r.amount ?? "").replace(/[,\s]/g, "")) || 0;
    if (!r.chargeTypeId && !amount) return;
    const n = `مصروف العميل ${i + 1}`;
    if (!r.chargeTypeId) throw new Error(`${n}: اختر النوع`);
    if (!(amount > 0)) throw new Error(`${n}: اكتب المبلغ`);
    const waybillId = Number(r.waybillId) || fallbackWaybillId || 0;
    if (!waybillId && !opts?.invoiceLevel) throw new Error(`${n}: اختر الشحنة`);
    const payer = r.payer === "customs_broker" || r.payer === "cash" ? r.payer : "driver_custody";
    if (payer === "cash" && !Number(r.cashAccountId)) throw new Error(`${n}: اختر الحساب الذي دفعت منه الشركة`);
    if (payer === "customs_broker" && !Number(r.partyId)) throw new Error(`${n}: اختر المخلص`);
    out.push({
      waybillId,
      charge: {
        chargeTypeId: Number(r.chargeTypeId),
        amount,
        billTo: "customer",
        payer,
        partyId: Number(r.partyId) || null,
        cashAccountId: Number(r.cashAccountId) || null,
        note: String(r.note ?? "").trim() || null,
      },
    });
  });
  return out;
}

/** أرقام الإيصالات المعلَّمة في النافذة (JSON). */
export function readIds(json: string): number[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  } catch {
    return [];
  }
}
