import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber } from "@/lib/ledger";
import { invoicePostingLines, lineVat, round2 } from "@/lib/invoice-posting";
import { rateOn, syncInvoiceTripTx, type InvoiceTripInput } from "@/lib/waybills";
import { SALES_ACCOUNTS } from "@/data/sales";
import type { DocFilter } from "@/lib/doc-filters";
import { docOrder, docWhere } from "@/lib/doc-query";

// الفاتورة التجميعية: عدة شحنات معتمدة لعميل واحد، سطر لكل شحنة. هنا يُقيد الإيراد (القرار 3).

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));

async function accountId(db: Db | Tx, code: string) {
  const [row] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!row) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return row.id;
}

async function lockInvoice(tx: Tx, id: number) {
  const [inv] = await tx.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, id)).for("update");
  if (!inv) throw new Error("الفاتورة غير موجودة");
  return inv;
}

/** رقم من سلسلة المسودات؛ الرقم الرسمي (INV) يُعطى عند أول إصدار فلا تنقطع سلسلة الفواتير الصادرة. */
const draftNumber = (tx: Tx, date: string) => nextDocumentNumber(tx, "sales_invoice_draft", "DRF", Number(date.slice(0, 4)));

/** أخذت الفاتورة رقماً رسمياً (أُصدرت ولو مرة)، فلا تُحذف حفاظاً على تسلسل الفواتير. */
export const hasOfficialNumber = (i: { number: string; draftNumber: string | null }) => i.number !== i.draftNumber;

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** الشحنات المعتمدة غير المفوترة (ليست على أي فاتورة، ولو مسودة). */
function uninvoicedWaybills() {
  return and(
    eq(s.waybills.status, "approved"),
    sql`not exists (select 1 from sales_invoice_lines l where l.waybill_id = ${s.waybills.id} and l.kind = 'waybill')`,
    // رحلة الفاتورة المباشرة إيرادها في فاتورتها
    isNull(s.waybills.sourceInvoiceId),
  );
}

/** قائمة الفوترة: لكل عميل وعملة عدد الشحنات المعتمدة غير المفوترة ومبلغها. */
export async function invoicingQueue(db: Db | Tx, upTo?: string) {
  return db
    .select({
      customerId: s.waybills.customerId,
      customer: s.parties.nameAr,
      currencyCode: s.waybills.currencyCode,
      count: sql<number>`count(*)::int`,
      amount: sql<string>`sum(${s.waybills.amount})`,
      from: sql<string>`min(${s.waybills.waybillDate})`,
      to: sql<string>`max(${s.waybills.waybillDate})`,
    })
    .from(s.waybills)
    .innerJoin(s.parties, eq(s.parties.id, s.waybills.customerId))
    .where(and(uninvoicedWaybills(), upTo ? lte(s.waybills.waybillDate, upTo) : undefined))
    .groupBy(s.waybills.customerId, s.parties.nameAr, s.waybills.currencyCode)
    .orderBy(asc(s.parties.nameAr));
}

/** يبني سطور الشحنات ومصاريفها المحمّلة على العميل، بعملة الفاتورة. */
async function buildLines(tx: Tx, waybillIds: number[], currencyCode: string, rate: number) {
  if (!waybillIds.length) return [];
  const [ext] = await tx.select({ id: s.costCenters.id }).from(s.costCenters).where(eq(s.costCenters.code, "EXT"));
  const acc = {
    domestic: await accountId(tx, SALES_ACCOUNTS.domesticRevenue),
    international: await accountId(tx, SALES_ACCOUNTS.internationalRevenue),
    recharged: await accountId(tx, SALES_ACCOUNTS.rechargedExpenses),
  };
  const rows = await tx
    .select({ w: s.waybills, plate: s.vehicles.plate, vehicleCc: s.vehicles.costCenterId, taxRate: s.taxCodes.rate })
    .from(s.waybills)
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.waybills.vehicleId))
    .leftJoin(s.taxCodes, eq(s.taxCodes.id, s.waybills.taxCodeId))
    .where(inArray(s.waybills.id, waybillIds))
    .orderBy(asc(s.waybills.waybillDate), asc(s.waybills.id));
  const routeNames = new Map(
    (
      await tx.execute<{ id: number; label: string }>(sql`
        select r.id, f.name_ar || ' ← ' || t.name_ar as label
        from routes r join locations f on f.id = r.from_location_id join locations t on t.id = r.to_location_id
        where r.id in (select route_id from waybills where id in (${sql.join(waybillIds.map((x) => sql`${x}`), sql`, `)}))`)
    ).map((r) => [Number(r.id), r.label]),
  );
  const expenses = await tx
    .select({ e: s.waybillExpenses, type: s.chargeTypes.nameAr })
    .from(s.waybillExpenses)
    .innerJoin(s.chargeTypes, eq(s.chargeTypes.id, s.waybillExpenses.chargeTypeId))
    .where(
      and(
        inArray(s.waybillExpenses.waybillId, waybillIds),
        eq(s.waybillExpenses.billTo, "customer"),
        sql`not exists (select 1 from sales_invoice_lines l where l.waybill_expense_id = ${s.waybillExpenses.id})`,
      ),
    );

  const lines: (typeof s.salesInvoiceLines.$inferInsert)[] = [];
  for (const { w, plate, vehicleCc, taxRate } of rows) {
    if (w.status !== "approved") throw new Error(`الشحنة ${w.number} غير معتمدة`);
    if (w.currencyCode !== currencyCode) throw new Error(`الشحنة ${w.number} بعملة ${w.currencyCode} والفاتورة بـ ${currencyCode}`);
    const vatRate = num(taxRate);
    const amount = num(w.amount);
    const base = {
      taxCodeId: w.taxCodeId,
      vatRate: String(vatRate),
      costCenterId: vehicleCc ?? ext?.id ?? null,
      waybillId: w.id,
    };
    lines.push({
      ...base,
      lineNo: 0,
      invoiceId: 0,
      kind: "waybill",
      description: `${w.number} · ${routeNames.get(w.routeId) ?? ""} · ${plate ?? "ناقل خارجي"} · ${w.waybillDate}`,
      amount: String(amount),
      vatAmount: String(lineVat(amount, vatRate)),
      accountId: w.isInternational ? acc.international : acc.domestic,
    });
    for (const { e, type } of expenses.filter((x) => x.e.waybillId === w.id)) {
      // المصروف بعملته، ويُحوَّل لعملة الفاتورة بسعري الصرف
      const converted = round2((num(e.amount) * num(e.exchangeRate)) / rate);
      lines.push({
        ...base,
        lineNo: 0,
        invoiceId: 0,
        kind: "expense",
        waybillExpenseId: e.id,
        description: `${type} – ${w.number}`,
        amount: String(converted),
        vatAmount: String(lineVat(converted, vatRate)),
        accountId: acc.recharged,
      });
    }
  }
  return lines;
}

async function recomputeTotals(tx: Tx, invoiceId: number) {
  const [t] = await tx
    .select({
      subtotal: sql<string>`coalesce(sum(${s.salesInvoiceLines.amount}), 0)`,
      vat: sql<string>`coalesce(sum(${s.salesInvoiceLines.vatAmount}), 0)`,
    })
    .from(s.salesInvoiceLines)
    .where(eq(s.salesInvoiceLines.invoiceId, invoiceId));
  const subtotal = round2(num(t.subtotal));
  const vat = round2(num(t.vat));
  await tx
    .update(s.salesInvoices)
    .set({ subtotal: String(subtotal), vatTotal: String(vat), total: String(round2(subtotal + vat)), updatedAt: new Date() })
    .where(eq(s.salesInvoices.id, invoiceId));
}

async function insertLines(tx: Tx, invoiceId: number, lines: (typeof s.salesInvoiceLines.$inferInsert)[]) {
  if (!lines.length) return;
  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(${s.salesInvoiceLines.lineNo}), 0)::int` })
    .from(s.salesInvoiceLines)
    .where(eq(s.salesInvoiceLines.invoiceId, invoiceId));
  await tx.insert(s.salesInvoiceLines).values(lines.map((l, i) => ({ ...l, invoiceId, lineNo: max + i + 1 })));
}

export interface InvoiceInput {
  customerId: number;
  invoiceDate: string;
  currencyCode?: string;
  // فارغ = كل الشحنات المعتمدة غير المفوترة للعميل حتى تاريخ الفاتورة
  waybillIds?: number[];
  notes?: string | null;
  userId?: number;
}

/** ينشئ فاتورة تجميعية مسودة من شحنات العميل المعتمدة. */
export async function createInvoice(db: Db, input: InvoiceInput) {
  return db.transaction(async (tx) => {
    const currency = input.currencyCode ?? "SAR";
    const candidates = await tx
      .select({ id: s.waybills.id, contractId: s.waybills.contractId })
      .from(s.waybills)
      .where(
        and(
          uninvoicedWaybills(),
          eq(s.waybills.customerId, input.customerId),
          eq(s.waybills.currencyCode, currency),
          lte(s.waybills.waybillDate, input.invoiceDate),
          input.waybillIds?.length ? inArray(s.waybills.id, input.waybillIds) : undefined,
        ),
      );
    if (input.waybillIds?.length && candidates.length !== input.waybillIds.length) {
      throw new Error("بعض الشحنات المختارة غير معتمدة أو مفوترة أو لعميل آخر");
    }
    if (!candidates.length) throw new Error("لا توجد شحنات معتمدة غير مفوترة لهذا العميل حتى تاريخ الفاتورة");

    const contractId = candidates.find((c) => c.contractId)?.contractId ?? null;
    const [contract] = contractId ? await tx.select().from(s.contracts).where(eq(s.contracts.id, contractId)) : [];
    const rate = await rateOn(tx, currency, input.invoiceDate);
    const number = await draftNumber(tx, input.invoiceDate);
    const [inv] = await tx
      .insert(s.salesInvoices)
      .values({
        number,
        draftNumber: number,
        invoiceDate: input.invoiceDate,
        dueDate: addDays(input.invoiceDate, contract?.paymentTermsDays ?? 30),
        customerId: input.customerId,
        contractId,
        currencyCode: currency,
        exchangeRate: String(rate),
        notes: input.notes || null,
        createdBy: input.userId,
      })
      .returning();
    await insertLines(tx, inv.id, await buildLines(tx, candidates.map((c) => c.id), currency, rate));
    await recomputeTotals(tx, inv.id);
    return inv;
  });
}

export interface ManualInvoiceInput {
  customerId: number;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  // رقم الفاتورة في النظام السابق أو رقم عرض السعر؛ فارغ للفاتورة المباشرة
  reference?: string | null;
  notes?: string | null;
  userId?: number;
  // رحلة السائق للفاتورة المباشرة؛ undefined = تبقى كما هي، null = بلا رحلة
  trip?: InvoiceTripInput | null;
  lines: {
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    amount: number;
    vatAmount: number;
    vatRate: number;
    taxCodeId: number | null;
    accountId: number;
    costCenterId: number | null;
  }[];
}

function manualLines(lines: ManualInvoiceInput["lines"]) {
  return lines.map((l) => ({
    invoiceId: 0,
    lineNo: 0,
    kind: "manual" as const,
    description: l.description,
    quantity: String(l.quantity),
    unitPrice: String(l.unitPrice),
    discountPercent: l.discountPercent ? String(l.discountPercent) : null,
    amount: String(l.amount),
    vatRate: String(l.vatRate),
    vatAmount: String(l.vatAmount),
    taxCodeId: l.taxCodeId,
    accountId: l.accountId,
    costCenterId: l.costCenterId,
  }));
}

function checkHeader(input: { invoiceDate: string; dueDate: string; customerId: number }) {
  if (!input.customerId) throw new Error("اختر العميل");
  if (!ISO_DATE.test(input.invoiceDate)) throw new Error("تاريخ الفاتورة إلزامي");
  if (!ISO_DATE.test(input.dueDate)) throw new Error("تاريخ الاستحقاق إلزامي");
  if (input.dueDate < input.invoiceDate) throw new Error("تاريخ الاستحقاق قبل تاريخ الفاتورة");
}

/** فاتورة مسودة بسطور حرة: مباشرة من صفحة الفواتير، أو من عرض سعر، أو مستوردة من Excel أو نظام سابق. */
export async function createManualInvoiceTx(tx: Tx, input: ManualInvoiceInput) {
  if (!input.lines.length) throw new Error("الفاتورة بلا بنود");
  checkHeader(input);
  const reference = input.reference?.trim() || null;
  if (reference) {
    const [dup] = await tx.select({ number: s.salesInvoices.number }).from(s.salesInvoices).where(eq(s.salesInvoices.reference, reference));
    if (dup) throw new Error(`المرجع ${reference} مسجل مسبقاً على الفاتورة ${dup.number}`);
  }
  const rate = await rateOn(tx, input.currencyCode, input.invoiceDate);
  const number = await draftNumber(tx, input.invoiceDate);
  const [inv] = await tx
    .insert(s.salesInvoices)
    .values({
      number,
      draftNumber: number,
      reference,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      customerId: input.customerId,
      currencyCode: input.currencyCode,
      exchangeRate: String(rate),
      notes: input.notes || null,
      createdBy: input.userId,
    })
    .returning();
  await insertLines(tx, inv.id, manualLines(input.lines));
  await recomputeTotals(tx, inv.id);
  return inv;
}

/** فاتورة مباشرة من صفحة الفواتير، دون شحنة؛ تُحفظ مسودة حتى تُعتمد. */
export async function createDirectInvoice(db: Db, input: ManualInvoiceInput) {
  return db.transaction(async (tx) => {
    const inv = await createManualInvoiceTx(tx, input);
    if (input.trip) await syncTrip(tx, inv.id, input.userId, input.trip);
    return inv;
  });
}

/** بيانات رحلة الفاتورة الحالية بصيغة الإدخال (للمحرر ولإعادة المزامنة). */
export async function currentTrip(db: Db | Tx, invoiceId: number): Promise<(InvoiceTripInput & { id: number; number: string; sentToDriverAt: Date | null; status: string }) | null> {
  const [w] = await db.select().from(s.waybills).where(eq(s.waybills.sourceInvoiceId, invoiceId));
  if (!w || !w.vehicleId) return null;
  return { id: w.id, number: w.number, sentToDriverAt: w.sentToDriverAt, status: w.status, routeId: w.routeId, vehicleId: w.vehicleId, driverId: w.driverId, shipper: w.shipper, consignee: w.consignee, tripCustody: num(w.tripCustody) };
}

async function syncTrip(tx: Tx, id: number, userId: number | undefined, trip: InvoiceTripInput | null) {
  const [inv] = await tx.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, id));
  return syncInvoiceTripTx(tx, { ...inv, userId }, trip);
}

/**
 * تعديل مسودة من النافذة: البيانات الأساسية والبنود الحرة. سطور الشحنات تبقى كما هي (تُدار من الشحنات)،
 * ولذلك لا يتغير العميل ولا العملة ما دامت فيها شحنات.
 */
export async function updateDirectInvoice(db: Db, id: number, input: ManualInvoiceInput) {
  checkHeader(input);
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status !== "draft") throw new Error(`الفاتورة ${inv.number} صادرة؛ أرجعها لمسودة لتعديلها`);
    const fixed = await tx.select({ kind: s.salesInvoiceLines.kind }).from(s.salesInvoiceLines).where(and(eq(s.salesInvoiceLines.invoiceId, id), sql`${s.salesInvoiceLines.kind} <> 'manual'`));
    if (fixed.length && (input.customerId !== inv.customerId || input.currencyCode !== inv.currencyCode)) throw new Error("في الفاتورة شحنات؛ لا يتغير العميل ولا العملة. فك الدمج أو أخرج الشحنات أولاً");
    if (!fixed.length && !input.lines.length) throw new Error("الفاتورة بلا بنود");
    if (fixed.length && input.invoiceDate !== inv.invoiceDate) {
      const [late] = await tx
        .select({ number: s.waybills.number, date: s.waybills.waybillDate })
        .from(s.waybills)
        .where(and(sql`${s.waybills.id} in (select waybill_id from sales_invoice_lines where invoice_id = ${id} and kind = 'waybill')`, sql`${s.waybills.waybillDate} > ${input.invoiceDate}`))
        .limit(1);
      if (late) throw new Error(`تاريخ الفاتورة قبل الشحنة ${late.number} (${late.date})`);
    }
    if (input.invoiceDate.slice(0, 4) !== inv.invoiceDate.slice(0, 4) && hasOfficialNumber(inv)) throw new Error("لا تُنقل فاتورة لها رقم رسمي إلى سنة أخرى");
    const reference = input.reference?.trim() || null;
    if (reference && reference !== inv.reference) {
      const [dup] = await tx.select({ number: s.salesInvoices.number }).from(s.salesInvoices).where(eq(s.salesInvoices.reference, reference));
      if (dup) throw new Error(`المرجع ${reference} مسجل مسبقاً على الفاتورة ${dup.number}`);
    }
    const rate = input.invoiceDate === inv.invoiceDate && input.currencyCode === inv.currencyCode ? num(inv.exchangeRate) : await rateOn(tx, input.currencyCode, input.invoiceDate);
    await tx
      .update(s.salesInvoices)
      .set({ customerId: input.customerId, invoiceDate: input.invoiceDate, dueDate: input.dueDate, currencyCode: input.currencyCode, exchangeRate: String(rate), reference, notes: input.notes?.trim() || null, updatedAt: new Date() })
      .where(eq(s.salesInvoices.id, id));
    await tx.delete(s.salesInvoiceLines).where(and(eq(s.salesInvoiceLines.invoiceId, id), eq(s.salesInvoiceLines.kind, "manual")));
    if (fixed.length && rate !== num(inv.exchangeRate)) {
      // سطور الشحنات بعملة الفاتورة بسعر يومها؛ تُبنى من جديد بالسعر الجديد
      const waybillIds = (await tx.selectDistinct({ id: s.salesInvoiceLines.waybillId }).from(s.salesInvoiceLines).where(and(eq(s.salesInvoiceLines.invoiceId, id), eq(s.salesInvoiceLines.kind, "waybill")))).map((r) => r.id!);
      await tx.delete(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, id));
      await insertLines(tx, id, await buildLines(tx, waybillIds, input.currencyCode, rate));
    }
    await insertLines(tx, id, manualLines(input.lines));
    await recomputeTotals(tx, id);
    // الرحلة تتبع الفاتورة (التاريخ والعميل والمبلغ)؛ بلا تغيير في بياناتها إن لم تُرسل
    const trip = input.trip !== undefined ? input.trip : await currentTrip(tx, id);
    if (input.trip !== undefined || trip) await syncTrip(tx, id, input.userId, trip);
    return { ...inv, number: inv.number };
  });
}

/** فوترة الكل: فاتورة لكل عميل وعملة بكل شحناته المعتمدة غير المفوترة. */
export async function createAllInvoices(db: Db, invoiceDate: string, userId?: number) {
  const queue = await invoicingQueue(db, invoiceDate);
  const created: { number: string; customer: string }[] = [];
  const errors: string[] = [];
  for (const q of queue) {
    try {
      const inv = await createInvoice(db, { customerId: q.customerId, invoiceDate, currencyCode: q.currencyCode, userId });
      created.push({ number: inv.number, customer: q.customer });
    } catch (err) {
      errors.push(`${q.customer}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { created, errors };
}

export async function addWaybillsToInvoice(db: Db, invoiceId: number, waybillIds: number[]) {
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== "draft") throw new Error("الفاتورة مُصدرة؛ أرجعها لمسودة أولاً");
    const ok = await tx
      .select({ id: s.waybills.id })
      .from(s.waybills)
      .where(and(uninvoicedWaybills(), eq(s.waybills.customerId, inv.customerId), inArray(s.waybills.id, waybillIds)));
    if (ok.length !== waybillIds.length) throw new Error("بعض الشحنات غير معتمدة أو مفوترة أو لعميل آخر");
    await insertLines(tx, invoiceId, await buildLines(tx, waybillIds, inv.currencyCode, num(inv.exchangeRate)));
    await recomputeTotals(tx, invoiceId);
  });
}

/** يحذف سطراً من مسودة؛ حذف سطر شحنة يحذف مصاريفها المحمّلة معه. */
export async function removeInvoiceLine(db: Db, invoiceId: number, lineId: number) {
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== "draft") throw new Error("الفاتورة مُصدرة؛ أرجعها لمسودة أولاً");
    const [line] = await tx
      .select()
      .from(s.salesInvoiceLines)
      .where(and(eq(s.salesInvoiceLines.id, lineId), eq(s.salesInvoiceLines.invoiceId, invoiceId)));
    if (!line) return;
    if (line.kind === "waybill") {
      await tx.delete(s.salesInvoiceLines).where(and(eq(s.salesInvoiceLines.invoiceId, invoiceId), eq(s.salesInvoiceLines.waybillId, line.waybillId!)));
    } else {
      await tx.delete(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.id, lineId));
    }
    await recomputeTotals(tx, invoiceId);
  });
}

/** الإصدار: يرحّل قيد الإيراد والضريبة، وتصبح شحناتها «مفوترة». */
export async function issueInvoice(db: Db, invoiceId: number, userId?: number) {
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== "draft") throw new Error(`الفاتورة ${inv.number} مُصدرة مسبقاً`);
    const lines = await tx.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, invoiceId)).orderBy(asc(s.salesInvoiceLines.lineNo));
    if (!lines.length || !(num(inv.total) > 0)) throw new Error("الفاتورة فارغة أو مبلغها صفر");
    const waybillIds = [...new Set(lines.map((l) => l.waybillId).filter((v): v is number => v != null))];
    const locked = await tx.select({ id: s.waybills.id, number: s.waybills.number, status: s.waybills.status }).from(s.waybills).where(inArray(s.waybills.id, waybillIds)).for("update");
    const notApproved = locked.filter((w) => w.status !== "approved");
    if (notApproved.length) throw new Error(`شحنات لم تعد معتمدة: ${notApproved.map((w) => w.number).join("، ")}`);

    // أول إصدار يأخذ الرقم الرسمي التالي، والمُرجعة لمسودة تحتفظ برقمها فلا تنقطع السلسلة
    if (!hasOfficialNumber(inv)) {
      inv.number = await nextDocumentNumber(tx, "sales_invoice", "INV", Number(inv.invoiceDate.slice(0, 4)));
      await tx.update(s.salesInvoices).set({ number: inv.number }).where(eq(s.salesInvoices.id, invoiceId));
    }
    const [vatOut] = await tx.select({ id: s.taxCodes.id }).from(s.taxCodes).where(eq(s.taxCodes.code, "VAT15-OUT"));
    const entry = await createJournalEntryTx(tx, {
      entryDate: inv.invoiceDate,
      description: `فاتورة مبيعات ${inv.number}`,
      source: { type: "sales_invoice", id: inv.id },
      post: true,
      userId,
      lines: invoicePostingLines(
        { number: inv.number, customerId: inv.customerId, currencyCode: inv.currencyCode, exchangeRate: num(inv.exchangeRate) },
        lines.map((l) => ({
          accountId: l.accountId,
          amount: num(l.amount),
          vatAmount: num(l.vatAmount),
          costCenterId: l.costCenterId,
          waybillId: l.waybillId,
          description: l.description,
        })),
        { receivable: await accountId(tx, SALES_ACCOUNTS.receivable), outputVat: await accountId(tx, SALES_ACCOUNTS.outputVat) },
        vatOut?.id ?? null,
      ),
    });
    await tx
      .update(s.salesInvoices)
      .set({ status: "issued", journalEntryId: entry.id, issuedBy: userId ?? null, issuedAt: new Date(), updatedAt: new Date() })
      .where(eq(s.salesInvoices.id, invoiceId));
    if (waybillIds.length) await tx.update(s.waybills).set({ status: "invoiced", updatedAt: new Date() }).where(inArray(s.waybills.id, waybillIds));
    return Object.assign(entry, { invoiceNumber: inv.number });
  });
}

/** الإرجاع لمسودة: يلغي القيد ويعيد الشحنات «معتمدة». يُمنع بعد تخصيص قبض عليها. */
export async function revertInvoice(db: Db, invoiceId: number) {
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== "issued") throw new Error("الفاتورة ليست مُصدرة");
    if (num(inv.paidAmount) > 0) throw new Error(`على الفاتورة ${inv.number} دفعات سداد؛ احذف الدفعة أو أرجعها أولاً`);
    if (inv.zatcaStatus === "accepted") throw new Error(`الفاتورة ${inv.number} معتمدة لدى هيئة الزكاة؛ لا تُعدّل، وتُصحح بإشعار دائن`);
    await tx.update(s.salesInvoices).set({ status: "draft", journalEntryId: null, issuedBy: null, issuedAt: null, updatedAt: new Date() }).where(eq(s.salesInvoices.id, invoiceId));
    if (inv.journalEntryId) await deleteEntryTx(tx, inv.journalEntryId);
    await tx
      .update(s.waybills)
      .set({ status: "approved", updatedAt: new Date() })
      .where(sql`${s.waybills.id} in (select waybill_id from sales_invoice_lines where invoice_id = ${invoiceId} and kind = 'waybill')`);
  });
}

export async function deleteInvoice(db: Db, invoiceId: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== "draft") throw new Error(`الفاتورة ${inv.number} صادرة؛ الحذف للمسودة فقط`);
    if (hasOfficialNumber(inv)) throw new Error(`الفاتورة ${inv.number} أُصدرت سابقاً وأخذت رقماً رسمياً، فلا تُحذف حفاظاً على تسلسل الفواتير. عدّلها وأعد إصدارها، أو ألغها بإشعار دائن بعد إصدارها`);
    await syncInvoiceTripTx(tx, { ...inv, userId: opts.userId }, null);
    const lines = await tx.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, invoiceId));
    await tx.insert(s.deletionLog).values({ entity: "sales_invoice", entityId: String(invoiceId), snapshot: { invoice: inv, lines }, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.salesInvoices).where(eq(s.salesInvoices.id, invoiceId));
  });
}

type LineRow = typeof s.salesInvoiceLines.$inferSelect;

/** مجموعات الفاتورة: كل شحنة بمصاريفها مجموعة، والبنود الحرة مجموعة لكل فاتورة دُمجت فيها (أو للفاتورة نفسها). */
function lineGroups(lines: LineRow[]) {
  const groups = new Map<string, LineRow[]>();
  for (const l of [...lines].sort((a, b) => a.lineNo - b.lineNo)) {
    const key = l.waybillId != null ? `w${l.waybillId}` : `m${l.groupKey ?? "own"}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return groups;
}

/** عدد ما يُفك دمجه في الفاتورة (شحنات وفواتير مدمجة)؛ أكثر من واحد يعني أنها مدمجة. */
export function mergedParts(lines: LineRow[]) {
  return lineGroups(lines).size;
}

/**
 * فك الدمج: تبقى الفاتورة بأول مجموعة (بنودها الأصلية أو أول شحنة)، وكل شحنة أو فاتورة مدمجة أخرى
 * تصبح فاتورة مسودة مستقلة برقم مسودة جديد. الحذف خطوة أخرى مستقلة.
 */
export async function unmergeInvoice(db: Db, invoiceId: number, userId?: number) {
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== "draft") throw new Error(`الفاتورة ${inv.number} صادرة؛ أرجعها لمسودة أولاً ثم فك الدمج`);
    const lines = await tx.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, invoiceId));
    const groups = [...lineGroups(lines).entries()];
    if (groups.length < 2) throw new Error(`الفاتورة ${inv.number} غير مدمجة: فيها شحنة واحدة أو بنودها فقط`);
    // البنود الحرة الأصلية تبقى في الفاتورة، وإلا أول شحنة
    const own = groups.findIndex(([k]) => k === "mown");
    const [keep] = groups.splice(own >= 0 ? own : 0, 1);
    const created: string[] = [];
    for (const [, part] of groups) {
      const number = await draftNumber(tx, inv.invoiceDate);
      const [piece] = await tx
        .insert(s.salesInvoices)
        .values({
          number,
          draftNumber: number,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate,
          customerId: inv.customerId,
          contractId: inv.contractId,
          currencyCode: inv.currencyCode,
          exchangeRate: inv.exchangeRate,
          notes: inv.notes,
          createdBy: userId ?? inv.createdBy,
        })
        .returning({ id: s.salesInvoices.id });
      await tx.update(s.salesInvoiceLines).set({ invoiceId: piece.id, groupKey: null }).where(inArray(s.salesInvoiceLines.id, part.map((l) => l.id)));
      await renumberLines(tx, piece.id);
      await recomputeTotals(tx, piece.id);
      created.push(number);
    }
    await tx.update(s.salesInvoiceLines).set({ groupKey: null }).where(inArray(s.salesInvoiceLines.id, keep[1].map((l) => l.id)));
    await renumberLines(tx, invoiceId);
    await recomputeTotals(tx, invoiceId);
    return { number: inv.number, created };
  });
}

async function renumberLines(tx: Tx, invoiceId: number) {
  await tx.execute(sql`
    update sales_invoice_lines l set line_no = r.n
    from (select id, row_number() over (order by line_no, id) as n from sales_invoice_lines where invoice_id = ${invoiceId}) r
    where l.id = r.id`);
}

/**
 * دمج مسودات لعميل واحد وعملة واحدة في فاتورة واحدة. تبقى الفاتورة ذات الرقم الرسمي إن وُجدت،
 * وإلا الأحدث تاريخاً، وتُحذف المسودات الأخرى بعد نقل بنودها (البنود الحرة تحفظ أصلها لفك الدمج).
 */
export async function mergeInvoices(db: Db, ids: number[], userId?: number) {
  const unique = [...new Set(ids)];
  if (unique.length < 2) throw new Error("حدد فاتورتين مسودة أو أكثر لنفس العميل");
  return db.transaction(async (tx) => {
    const invs = await tx.select().from(s.salesInvoices).where(inArray(s.salesInvoices.id, unique)).for("update");
    const issued = invs.filter((i) => i.status !== "draft");
    if (issued.length) throw new Error(`الدمج للمسودات فقط؛ صادرة: ${issued.map((i) => i.number).join("، ")}`);
    if (new Set(invs.map((i) => `${i.customerId}:${i.currencyCode}`)).size > 1) throw new Error("الفواتير المحددة لعملاء أو عملات مختلفة؛ الدمج لفواتير عميل واحد بعملة واحدة");
    const official = invs.filter(hasOfficialNumber);
    if (official.length > 1) throw new Error(`لكل من ${official.map((i) => i.number).join(" و")} رقم رسمي؛ لا تُدمج فاتورتان أُصدرتا سابقاً`);
    const host = official[0] ?? [...invs].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || a.id - b.id)[0];
    const others = invs.filter((i) => i.id !== host.id);
    const [late] = await tx
      .select({ number: s.waybills.number, date: s.waybills.waybillDate })
      .from(s.waybills)
      .where(and(sql`${s.waybills.id} in (select waybill_id from sales_invoice_lines where invoice_id in (${sql.join(others.map((o) => sql`${o.id}`), sql`, `)}))`, sql`${s.waybills.waybillDate} > ${host.invoiceDate}`))
      .limit(1);
    if (late) throw new Error(`تاريخ الفاتورة ${host.number} (${host.invoiceDate}) قبل الشحنة ${late.number}؛ عدّل التاريخ ثم ادمج`);
    for (const o of others) {
      await tx.execute(sql`
        update sales_invoice_lines set invoice_id = ${host.id}, line_no = line_no + 1000,
          group_key = case when kind = 'manual' then coalesce(group_key, ${o.id}) else group_key end
        where invoice_id = ${o.id}`);
      const notes = o.notes && o.notes !== host.notes ? o.notes : null;
      if (notes) await tx.update(s.salesInvoices).set({ notes: [host.notes, notes].filter(Boolean).join(" · ") }).where(eq(s.salesInvoices.id, host.id));
      // رحلات الفواتير المدمجة تتبع الفاتورة الباقية
      await tx.update(s.waybills).set({ sourceInvoiceId: host.id }).where(eq(s.waybills.sourceInvoiceId, o.id));
      await tx.delete(s.salesInvoices).where(eq(s.salesInvoices.id, o.id));
    }
    await renumberLines(tx, host.id);
    await recomputeTotals(tx, host.id);
    void userId;
    return { number: host.number, id: host.id, merged: others.map((o) => o.number) };
  });
}

/**
 * إخراج شحنات من مسوداتها (فك الدمج من صفحة الشحنات): تعود «بانتظار الفوترة»،
 * والمسودة التي لا يبقى فيها شيء تُحذف إن لم يكن لها رقم رسمي.
 */
export async function removeWaybillsFromDrafts(db: Db, waybillIds: number[]) {
  const done: string[] = [];
  const skipped: string[] = [];
  for (const wid of [...new Set(waybillIds)]) {
    try {
      await db.transaction(async (tx) => {
        const [w] = await tx.select({ number: s.waybills.number }).from(s.waybills).where(eq(s.waybills.id, wid));
        const [line] = await tx.select({ invoiceId: s.salesInvoiceLines.invoiceId }).from(s.salesInvoiceLines).where(and(eq(s.salesInvoiceLines.waybillId, wid), eq(s.salesInvoiceLines.kind, "waybill")));
        if (!line) throw new Error(`${w?.number}: غير مدمجة في فاتورة`);
        const inv = await lockInvoice(tx, line.invoiceId);
        if (inv.status !== "draft") throw new Error(`${w?.number}: فاتورتها ${inv.number} صادرة؛ أرجعها لمسودة أولاً`);
        await tx.delete(s.salesInvoiceLines).where(and(eq(s.salesInvoiceLines.invoiceId, inv.id), eq(s.salesInvoiceLines.waybillId, wid)));
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, inv.id));
        if (n === 0) {
          if (hasOfficialNumber(inv)) throw new Error(`${w?.number}: هي آخر ما في الفاتورة ${inv.number} ذات الرقم الرسمي؛ أضف لها بنداً أولاً`);
          await tx.delete(s.salesInvoices).where(eq(s.salesInvoices.id, inv.id));
        } else {
          await renumberLines(tx, inv.id);
          await recomputeTotals(tx, inv.id);
        }
        done.push(w.number);
      });
    } catch (err) {
      skipped.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { done, skipped };
}

// ───────────── قائمة الفواتير والتعديل من الشيت ─────────────

const salesCols = {
  id: s.salesInvoices.id,
  number: s.salesInvoices.number,
  date: s.salesInvoices.invoiceDate,
  due: s.salesInvoices.dueDate,
  total: s.salesInvoices.total,
  paid: s.salesInvoices.paidAmount,
  status: s.salesInvoices.status,
  party: s.parties.nameAr,
  search: [s.salesInvoices.notes],
};

export async function listSalesInvoices(db: Db | Tx, f: DocFilter, limit = 500) {
  return db
    .select({
      i: s.salesInvoices,
      customer: s.parties.nameAr,
      waybills: sql<number>`(select count(*) from sales_invoice_lines l where l.invoice_id = ${s.salesInvoices.id} and l.kind = 'waybill')::int`,
      // أجزاء الدمج (كل شحنة، وكل فاتورة دُمجت ببنودها)؛ أكثر من جزء = مدمجة
      // رحلات السائقين في الفاتورة وكم منها أُرسل
      trips: sql<number>`(select count(*) from waybills w where w.execution = 'fleet' and (w.source_invoice_id = ${s.salesInvoices.id} or w.id in (select waybill_id from sales_invoice_lines where invoice_id = ${s.salesInvoices.id} and kind = 'waybill')))::int`,
      tripsSent: sql<number>`(select count(*) from waybills w where w.execution = 'fleet' and w.sent_to_driver_at is not null and (w.source_invoice_id = ${s.salesInvoices.id} or w.id in (select waybill_id from sales_invoice_lines where invoice_id = ${s.salesInvoices.id} and kind = 'waybill')))::int`,
      parts: sql<number>`(select count(distinct coalesce('w' || l.waybill_id, 'm' || coalesce(l.group_key::text, 'own'))) from sales_invoice_lines l where l.invoice_id = ${s.salesInvoices.id})::int`,
    })
    .from(s.salesInvoices)
    .innerJoin(s.parties, eq(s.parties.id, s.salesInvoices.customerId))
    .where(docWhere(salesCols, f, "issued"))
    .orderBy(...docOrder(salesCols, f.sort))
    .limit(limit);
}

/** الفاتورة بعميلها وسطورها، لعرضها ضريبيةً في المعاينة والصفحة والطباعة. */
export async function salesInvoiceDoc(db: Db | Tx, id: number) {
  const [row] = await db
    .select({ i: s.salesInvoices, customer: s.parties })
    .from(s.salesInvoices)
    .innerJoin(s.parties, eq(s.parties.id, s.salesInvoices.customerId))
    .where(eq(s.salesInvoices.id, id));
  if (!row) return null;
  const [lines, trips] = await Promise.all([
    db.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, id)).orderBy(asc(s.salesInvoiceLines.lineNo)),
    invoiceTrips(db, id),
  ]);
  return { ...row, lines, trips };
}

/** رحلات السائقين في الفاتورة (رحلتها المباشرة والشحنات التي فيها) وحالة إرسالها. */
export async function invoiceTrips(db: Db | Tx, id: number) {
  return db
    .select({
      id: s.waybills.id,
      number: s.waybills.number,
      status: s.waybills.status,
      sentAt: s.waybills.sentToDriverAt,
      acceptedAt: s.waybills.driverAcceptedAt,
      custody: s.waybills.tripCustody,
      linked: sql<boolean>`${s.waybills.sourceInvoiceId} is not null`,
    })
    .from(s.waybills)
    .where(
      and(
        eq(s.waybills.execution, "fleet"),
        sql`(${s.waybills.sourceInvoiceId} = ${id} or "waybills"."id" in (select waybill_id from sales_invoice_lines where invoice_id = ${id} and kind = 'waybill'))`,
      ),
    )
    .orderBy(asc(s.waybills.id));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface DraftInvoicePatch {
  invoiceDate?: string;
  dueDate?: string;
  notes?: string | null;
}

/**
 * تعديل مسودة من الشيت. تغيير التاريخ يعيد سعر الصرف وسطور الشحنات بسعر اليوم الجديد،
 * ويُزاح الاستحقاق بنفس المدة ما لم يُحدد.
 */
export async function updateDraftInvoice(db: Db, id: number, patch: DraftInvoicePatch) {
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status !== "draft") throw new Error(`الفاتورة ${inv.number} مُصدرة؛ أرجعها لمسودة لتعديلها`);
    const invoiceDate = patch.invoiceDate ?? inv.invoiceDate;
    for (const d of [patch.invoiceDate, patch.dueDate]) if (d !== undefined && !ISO_DATE.test(d)) throw new Error(`تاريخ غير صحيح: ${d}`);
    const dateChanged = invoiceDate !== inv.invoiceDate;
    if (dateChanged && invoiceDate.slice(0, 4) !== inv.invoiceDate.slice(0, 4)) throw new Error("لا تُنقل الفاتورة لسنة أخرى؛ احذفها وأنشئها بالتاريخ الجديد");
    const dueDate = patch.dueDate ?? (dateChanged ? addDays(invoiceDate, Math.round((Date.parse(inv.dueDate) - Date.parse(inv.invoiceDate)) / 86_400_000)) : inv.dueDate);
    if (dueDate < invoiceDate) throw new Error("تاريخ الاستحقاق قبل تاريخ الفاتورة");

    let exchangeRate = inv.exchangeRate;
    if (dateChanged) {
      const lines = await tx.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, id)).orderBy(asc(s.salesInvoiceLines.lineNo));
      const waybillIds = [...new Set(lines.filter((l) => l.kind === "waybill").map((l) => l.waybillId!))];
      if (waybillIds.length) {
        const [late] = await tx
          .select({ number: s.waybills.number, date: s.waybills.waybillDate })
          .from(s.waybills)
          .where(and(inArray(s.waybills.id, waybillIds), sql`${s.waybills.waybillDate} > ${invoiceDate}`))
          .limit(1);
        if (late) throw new Error(`تاريخ الفاتورة قبل الشحنة ${late.number} (${late.date})`);
      }
      const rate = await rateOn(tx, inv.currencyCode, invoiceDate);
      if (rate !== num(inv.exchangeRate)) {
        exchangeRate = String(rate);
        // السطور الحرة بعملة الفاتورة أصلاً فلا تتأثر بسعر الصرف
        await tx.delete(s.salesInvoiceLines).where(and(eq(s.salesInvoiceLines.invoiceId, id), sql`${s.salesInvoiceLines.kind} <> 'manual'`));
        await insertLines(tx, id, await buildLines(tx, waybillIds, inv.currencyCode, rate));
      }
    }
    await tx
      .update(s.salesInvoices)
      .set({ invoiceDate, dueDate, exchangeRate, notes: patch.notes === undefined ? inv.notes : patch.notes?.trim() || null, updatedAt: new Date() })
      .where(eq(s.salesInvoices.id, id));
    if (dateChanged) await recomputeTotals(tx, id);
  });
}

// سندات القبض في src/lib/receipts.ts
export { createReceipt, deleteReceipt, postReceipt, revertReceipt, type ReceiptInput } from "@/lib/receipts";

/** الصناديق والبنوك التفصيلية لقائمة الاختيار. */
/** الحسابات التي يُصرف منها النقد للسائق: الصناديق والبنوك أولاً، ثم بقية حسابات الأصول والالتزامات التفصيلية. */
export async function fundingAccounts(db: Db | Tx) {
  return db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr, currencyCode: s.accounts.currencyCode })
    .from(s.accounts)
    .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), sql`(${s.accounts.code} like '1%' or ${s.accounts.code} like '2%')`))
    .orderBy(sql`case when ${s.accounts.code} like '1101%' or ${s.accounts.code} like '1102%' then 0 else 1 end`, asc(s.accounts.code));
}

export async function cashAccounts(db: Db | Tx) {
  return db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr, currencyCode: s.accounts.currencyCode })
    .from(s.accounts)
    .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), sql`(${s.accounts.code} like '1101%' or ${s.accounts.code} like '1102%')`))
    .orderBy(asc(s.accounts.code));
}

