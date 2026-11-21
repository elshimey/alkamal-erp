import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx } from "@/lib/ledger";
import { todayRiyadh } from "@/lib/dates";
import { createPayment, payableAccountFor } from "@/lib/purchases";
import { postChargeTx } from "@/lib/customer-charges";
import { lockWaybill, waybillAccountIds } from "@/lib/waybills";
import { WAYBILL_ACCOUNTS } from "@/data/waybills";

// «سندات صرف تحت المراجعة» (خطة التقارير والمصروفات 2026-11-21، الخطوة 2):
// ما سُجّل «لم يُدفع بعد» يُعتمد هنا فيُقيد التزاماً (IAS 37: مصروف مستحق على المستفيد أو 2106)،
// ثم يُسدد بسند صرف «مصروف مستحق» يقفل الالتزام. وعهدة الرحلة المرسلة «لم تُصرف بعد» تُصرف من هنا.
// لا قيد قبل الاعتماد، والفاتورة لا تصدر وفيها مصروف على العميل لم يُعتمد.

const route = sql<string | null>`(select fl.name_ar || ' ← ' || tl.name_ar from routes r join locations fl on fl.id = r.from_location_id join locations tl on tl.id = r.to_location_id where r.id = ${s.waybills.routeId})`;
const driverName = sql<string | null>`(select e.name_ar from drivers d join employees e on e.id = d.employee_id where d.id = ${s.waybills.driverId})`;
const plate = sql<string | null>`(select v.plate from vehicles v where v.id = ${s.waybills.vehicleId})`;
const paidPosted = (paymentId: typeof s.waybillExpenses.paymentId | typeof s.expenses.paymentId) =>
  sql`exists (select 1 from payments p where p.id = ${paymentId} and p.status = 'posted')`;

/** حساب الالتزام: ذمة المستفيد حسب دوره، أو «مصروفات مستحقة» 2106 إن لم يُعرف. */
export async function accruedAccountFor(db: Db | Tx, partyId: number | null) {
  if (partyId) return payableAccountFor(db, partyId);
  const [a] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, WAYBILL_ACCOUNTS.accrued));
  if (!a) throw new Error(`الحساب ${WAYBILL_ACCOUNTS.accrued} غير موجود في الشجرة`);
  return a.id;
}

/** مصاريف على العميل «لم يُدفع بعد» لم تُسدد: بانتظار الاعتماد أو معتمدة تنتظر السداد. */
export async function unpaidCharges(db: Db | Tx, opts: { invoiceId?: number } = {}) {
  const invoiceOf = sql<number | null>`coalesce(${s.waybillExpenses.invoiceId}, (select l.invoice_id from sales_invoice_lines l where l.waybill_expense_id = ${s.waybillExpenses.id} limit 1))`;
  return db
    .select({
      id: s.waybillExpenses.id,
      waybillId: s.waybillExpenses.waybillId,
      waybill: s.waybills.number,
      date: sql<string>`coalesce(${s.waybills.waybillDate}, ${s.salesInvoices.invoiceDate})`,
      invoiceId: invoiceOf.mapWith((v: string | number | null) => (v == null ? null : Number(v))),
      invoice: sql<string | null>`(select i.number from sales_invoices i where i.id = ${invoiceOf})`,
      customer: sql<string>`(select p.name_ar from parties p where p.id = coalesce(${s.waybills.customerId}, ${s.salesInvoices.customerId}))`,
      driver: driverName,
      vehicle: plate,
      route,
      type: s.chargeTypes.nameAr,
      note: s.waybillExpenses.note,
      billTo: s.waybillExpenses.billTo,
      amount: s.waybillExpenses.amount,
      currencyCode: s.waybillExpenses.currencyCode,
      payeeId: s.waybillExpenses.partyId,
      payee: sql<string | null>`(select p.name_ar from parties p where p.id = ${s.waybillExpenses.partyId})`,
      approved: sql<boolean>`${s.waybillExpenses.journalEntryId} is not null`,
    })
    .from(s.waybillExpenses)
    .innerJoin(s.chargeTypes, eq(s.chargeTypes.id, s.waybillExpenses.chargeTypeId))
    .leftJoin(s.waybills, eq(s.waybills.id, s.waybillExpenses.waybillId))
    .leftJoin(s.salesInvoices, eq(s.salesInvoices.id, s.waybillExpenses.invoiceId))
    .where(
      and(
        eq(s.waybillExpenses.payer, "unpaid"),
        // مصروف مباشر محمّل على العميل يُراجَع ويُسدد من تبويب المصروفات
        isNull(s.waybillExpenses.sourceExpenseId),
        sql`not ${paidPosted(s.waybillExpenses.paymentId)}`,
        opts.invoiceId ? sql`${invoiceOf} = ${opts.invoiceId}` : undefined,
      ),
    )
    .orderBy(asc(sql`coalesce(${s.waybills.waybillDate}, ${s.salesInvoices.invoiceDate})`), asc(s.waybillExpenses.id));
}

/** المصروفات المباشرة «لم يُدفع بعد» غير المسددة (المعلّقة والمعتمدة). */
export async function unpaidExpenses(db: Db | Tx) {
  return db
    .select({
      id: s.expenses.id,
      number: s.expenses.number,
      date: s.expenses.expenseDate,
      description: s.expenses.description,
      account: s.accounts.nameAr,
      accountCode: s.accounts.code,
      driver: sql<string | null>`(select e.name_ar from drivers d join employees e on e.id = d.employee_id where d.id = ${s.expenses.driverId})`,
      vehicle: sql<string | null>`(select v.plate from vehicles v where v.id = ${s.expenses.vehicleId})`,
      waybillId: s.expenses.waybillId,
      waybill: sql<string | null>`(select w.number from waybills w where w.id = ${s.expenses.waybillId})`,
      billToCustomer: s.expenses.billToCustomer,
      total: sql<string>`${s.expenses.amount} + ${s.expenses.vatAmount}`,
      currencyCode: s.expenses.currencyCode,
      payeeId: s.expenses.partyId,
      payee: sql<string | null>`(select p.name_ar from parties p where p.id = ${s.expenses.partyId})`,
      approved: sql<boolean>`${s.expenses.status} = 'approved'`,
    })
    .from(s.expenses)
    .innerJoin(s.accounts, eq(s.accounts.id, s.expenses.accountId))
    .where(and(eq(s.expenses.payer, "unpaid"), inArray(s.expenses.status, ["pending", "approved"]), sql`not ${paidPosted(s.expenses.paymentId)}`))
    .orderBy(asc(s.expenses.expenseDate), asc(s.expenses.id));
}

/** رحلات أُرسلت للسائق وعهدتها «لم تُصرف بعد». */
export async function undisbursedCustody(db: Db | Tx) {
  return db
    .select({
      id: s.waybills.id,
      number: s.waybills.number,
      date: s.waybills.waybillDate,
      driver: driverName,
      vehicle: plate,
      route,
      custody: s.waybills.tripCustody,
      status: s.waybills.status,
    })
    .from(s.waybills)
    .where(and(isNotNull(s.waybills.sentToDriverAt), gt(s.waybills.tripCustody, "0"), isNull(s.waybills.custodyPaymentId), ne(s.waybills.status, "rejected")))
    .orderBy(asc(s.waybills.waybillDate), asc(s.waybills.id));
}

/** عدد ما ينتظر في الصفحة (للجرس والفاتورة). */
export async function reviewCounts(db: Db | Tx) {
  const [charges, expenses, custody] = await Promise.all([unpaidCharges(db), unpaidExpenses(db), undisbursedCustody(db)]);
  return { charges: charges.length, expenses: expenses.length, custody: custody.length };
}

async function lockCharge(tx: Tx, id: number) {
  const [e] = await tx.select().from(s.waybillExpenses).where(eq(s.waybillExpenses.id, id)).for("update");
  if (!e) throw new Error("المصروف غير موجود");
  if (e.payer !== "unpaid") throw new Error("المصروف ليس «لم يُدفع بعد»");
  return e;
}

/** اعتماد مصروف على العميل «لم يُدفع بعد»: قيد مدين 1114 (أو التكلفة) دائن ذمة المستفيد أو 2106. */
export async function approveChargeTx(tx: Tx, id: number, userId?: number) {
  const e = await lockCharge(tx, id);
  if (e.journalEntryId) throw new Error("المصروف معتمد مسبقاً");
  const payable = await accruedAccountFor(tx, e.partyId);
  if (e.waybillId) {
    const w = await lockWaybill(tx, e.waybillId);
    if (w.status === "rejected") throw new Error(`الشحنة ${w.number} مرفوضة`);
    await postChargeTx(tx, w, e.id, userId, payable);
  } else {
    const [inv] = await tx.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, e.invoiceId!));
    const [type] = await tx.select({ name: s.chargeTypes.nameAr }).from(s.chargeTypes).where(eq(s.chargeTypes.id, e.chargeTypeId));
    const acc = await waybillAccountIds(tx);
    const fx = { currencyCode: e.currencyCode, exchangeRate: Number(e.exchangeRate) };
    const description = `${type.name} – ${inv.number}`;
    const amount = Number(e.amount);
    const today = todayRiyadh();
    const entry = await createJournalEntryTx(tx, {
      entryDate: today > inv.invoiceDate ? today : inv.invoiceDate,
      description: `مصروف على العميل في الفاتورة ${inv.number}: ${type.name}`,
      source: { type: "invoice_charge", id: e.id },
      post: true,
      userId,
      lines: [
        { accountId: acc.rechargeable, ...fx, description: `على العميل: ${description}`, debit: amount },
        { accountId: payable, ...fx, partyId: e.partyId, description, credit: amount },
      ],
    });
    await tx.update(s.waybillExpenses).set({ journalEntryId: entry.id }).where(eq(s.waybillExpenses.id, e.id));
  }
  await tx.update(s.waybillExpenses).set({ approvedAt: new Date(), approvedBy: userId ?? null }).where(eq(s.waybillExpenses.id, e.id));
}

export async function approveCharges(db: Db, ids: number[], userId?: number) {
  return db.transaction(async (tx) => {
    for (const id of [...new Set(ids)]) await approveChargeTx(tx, id, userId);
  });
}

export interface PayInput {
  kind: "charge" | "expense";
  id: number;
  cashAccountId?: number | null;
  date?: string;
  userId?: number;
}

/** سداد مصروف «لم يُدفع بعد» معتمد بسند صرف مرحّل: مدين الالتزام دائن الصندوق أو البنك. */
export async function payAccrued(db: Db, p: PayInput) {
  if (!p.cashAccountId) throw new Error("اختر الصندوق أو البنك الذي دُفع منه");
  return db.transaction(async (tx) => {
    let row: { partyId: number | null; amount: number; currencyCode: string; exchangeRate: number; label: string; ref: string; paymentId: number | null };
    if (p.kind === "charge") {
      const e = await lockCharge(tx, p.id);
      if (!e.journalEntryId) throw new Error("اعتمد المصروف أولاً ثم سدده");
      const [type] = await tx.select({ name: s.chargeTypes.nameAr }).from(s.chargeTypes).where(eq(s.chargeTypes.id, e.chargeTypeId));
      const [doc] = e.waybillId
        ? await tx.select({ number: s.waybills.number }).from(s.waybills).where(eq(s.waybills.id, e.waybillId))
        : await tx.select({ number: s.salesInvoices.number }).from(s.salesInvoices).where(eq(s.salesInvoices.id, e.invoiceId!));
      row = { partyId: e.partyId, amount: Number(e.amount), currencyCode: e.currencyCode, exchangeRate: Number(e.exchangeRate), label: `${type.name} – ${doc.number}`, ref: doc.number, paymentId: e.paymentId };
    } else {
      const [e] = await tx.select().from(s.expenses).where(eq(s.expenses.id, p.id)).for("update");
      if (!e || e.payer !== "unpaid") throw new Error("المصروف ليس «لم يُدفع بعد»");
      if (e.status !== "approved") throw new Error(`اعتمد المصروف ${e.number} أولاً ثم سدده`);
      row = {
        partyId: e.partyId,
        amount: Math.round((Number(e.amount) + Number(e.vatAmount)) * 100) / 100,
        currencyCode: e.currencyCode,
        exchangeRate: Number(e.exchangeRate),
        label: `${e.number} – ${e.description}`,
        ref: e.number,
        paymentId: e.paymentId,
      };
    }
    if (row.paymentId) {
      const [old] = await tx.select({ number: s.payments.number, status: s.payments.status }).from(s.payments).where(eq(s.payments.id, row.paymentId));
      if (old?.status === "posted") throw new Error(`سُدد من قبل بالسند ${old.number}`);
      if (old) throw new Error(`له سند صرف مسودة ${old.number}؛ رحّله أو احذفه من سندات الصرف`);
    }
    const [cash] = await tx.select({ code: s.accounts.code }).from(s.accounts).where(eq(s.accounts.id, p.cashAccountId!));
    const payment = await createPayment(tx as unknown as Db, {
      paymentDate: p.date ?? todayRiyadh(),
      kind: "expense",
      partyId: row.partyId,
      debitAccountId: await accruedAccountFor(tx, row.partyId),
      amount: row.amount,
      currencyCode: row.currencyCode,
      exchangeRate: row.exchangeRate,
      method: cash?.code.startsWith("1102") ? "transfer" : "cash",
      cashAccountId: p.cashAccountId!,
      reference: row.ref,
      notes: `سداد ${row.label}`,
      post: true,
      userId: p.userId,
    });
    if (p.kind === "charge") await tx.update(s.waybillExpenses).set({ paymentId: payment.id }).where(eq(s.waybillExpenses.id, p.id));
    else await tx.update(s.expenses).set({ paymentId: payment.id }).where(eq(s.expenses.id, p.id));
    return payment;
  });
}

/** هل في الفاتورة مصروف على العميل لم يُعتمد (للتنبيه في صفحتها). */
export async function invoicePendingCharges(db: Db | Tx, invoiceId: number) {
  return (await unpaidCharges(db, { invoiceId })).filter((c) => !c.approved);
}
