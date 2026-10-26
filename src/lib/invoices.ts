import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber } from "@/lib/ledger";
import { invoicePostingLines, lineVat, round2 } from "@/lib/invoice-posting";
import { rateOn } from "@/lib/waybills";
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
    const number = await nextDocumentNumber(tx, "sales_invoice", "INV", Number(input.invoiceDate.slice(0, 4)));
    const [inv] = await tx
      .insert(s.salesInvoices)
      .values({
        number,
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
  reference: string;
  notes?: string | null;
  userId?: number;
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

/** فاتورة مسودة بسطور حرة (المستوردة من Excel أو نظام سابق)، بلا شحنات. */
export async function createManualInvoiceTx(tx: Tx, input: ManualInvoiceInput) {
  if (!input.lines.length) throw new Error("الفاتورة بلا بنود");
  const [dup] = await tx.select({ number: s.salesInvoices.number }).from(s.salesInvoices).where(eq(s.salesInvoices.reference, input.reference));
  if (dup) throw new Error(`الفاتورة ${input.reference} مستوردة مسبقاً برقم ${dup.number}`);
  const rate = await rateOn(tx, input.currencyCode, input.invoiceDate);
  const number = await nextDocumentNumber(tx, "sales_invoice", "INV", Number(input.invoiceDate.slice(0, 4)));
  const [inv] = await tx
    .insert(s.salesInvoices)
    .values({
      number,
      reference: input.reference,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      customerId: input.customerId,
      currencyCode: input.currencyCode,
      exchangeRate: String(rate),
      notes: input.notes || null,
      createdBy: input.userId,
    })
    .returning();
  await insertLines(
    tx,
    inv.id,
    input.lines.map((l) => ({
      invoiceId: inv.id,
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
    })),
  );
  await recomputeTotals(tx, inv.id);
  return inv;
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
    await tx.update(s.waybills).set({ status: "invoiced", updatedAt: new Date() }).where(inArray(s.waybills.id, waybillIds));
    return entry;
  });
}

/** الإرجاع لمسودة: يلغي القيد ويعيد الشحنات «معتمدة». يُمنع بعد تخصيص قبض عليها. */
export async function revertInvoice(db: Db, invoiceId: number) {
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (inv.status !== "issued") throw new Error("الفاتورة ليست مُصدرة");
    if (num(inv.paidAmount) > 0) throw new Error("على الفاتورة سندات قبض مخصصة؛ أرجع السندات أولاً");
    if (inv.zatcaStatus === "accepted") throw new Error("الفاتورة مقبولة لدى الزكاة؛ صحّحها بإشعار دائن");
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
    if (inv.status !== "draft") throw new Error("الحذف متاح للمسودة فقط");
    const lines = await tx.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, invoiceId));
    await tx.insert(s.deletionLog).values({ entity: "sales_invoice", entityId: String(invoiceId), snapshot: { invoice: inv, lines }, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.salesInvoices).where(eq(s.salesInvoices.id, invoiceId));
  });
}

/**
 * فك دمج فاتورة مسودة: تُحذف المسودة (مع نسخة في سجل المحذوفات) وتعود شحناتها «بانتظار الفوترة».
 * الفاتورة المصدرة تُرجع لمسودة أولاً، وذلك ممنوع إذا خُصص عليها قبض.
 */
export async function unmergeInvoice(db: Db, invoiceId: number, userId?: number) {
  const [inv] = await db.select({ status: s.salesInvoices.status, number: s.salesInvoices.number }).from(s.salesInvoices).where(eq(s.salesInvoices.id, invoiceId));
  if (!inv) throw new Error("الفاتورة غير موجودة");
  if (inv.status !== "draft") throw new Error(`الفاتورة ${inv.number} مُصدرة؛ أرجعها لمسودة أولاً ثم فك الدمج`);
  const lines = await db.select({ n: sql<number>`count(distinct waybill_id)::int` }).from(s.salesInvoiceLines).where(and(eq(s.salesInvoiceLines.invoiceId, invoiceId), eq(s.salesInvoiceLines.kind, "waybill")));
  await deleteInvoice(db, invoiceId, { reason: "فك دمج الشحنات", userId });
  return { number: inv.number, waybills: lines[0]?.n ?? 0 };
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
  const lines = await db.select().from(s.salesInvoiceLines).where(eq(s.salesInvoiceLines.invoiceId, id)).orderBy(asc(s.salesInvoiceLines.lineNo));
  return { ...row, lines };
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
export async function cashAccounts(db: Db | Tx) {
  return db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr, currencyCode: s.accounts.currencyCode })
    .from(s.accounts)
    .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), sql`(${s.accounts.code} like '1101%' or ${s.accounts.code} like '1102%')`))
    .orderBy(asc(s.accounts.code));
}

