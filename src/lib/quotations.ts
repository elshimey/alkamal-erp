import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { nextDocumentNumber } from "@/lib/ledger";
import { createManualInvoiceTx } from "@/lib/invoices";

export { QUOTE_STATUS, QUOTE_SORTS, SHIPPING_TYPES, isShippingType, parseQuoteFilter, type QuoteListParams, type QuoteStatus, type ShippingType } from "@/lib/quotations-data";
import { SHIPPING_TYPES, QUOTE_STATUS, type QuoteStatus, type ShippingType, type parseQuoteFilter } from "@/lib/quotations-data";

const round2 = (n: number) => Math.round(n * 100) / 100;
const DOMESTIC = "4101";
const INTERNATIONAL = "4102";

export interface QuoteLineInput {
  routeId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  /** فارغ = حسب نوع الشحن (دولي صفر، داخلي 15) */
  vatRate?: number | null;
}

export interface QuoteInput {
  date: string;
  validUntil: string;
  customerId: number;
  currencyCode?: string;
  shippingType?: ShippingType;
  reference?: string | null;
  notes?: string | null;
  terms?: string | null;
  lines: QuoteLineInput[];
  userId?: number;
}

type BuiltLine = { lineNo: number; routeId: number | null; description: string; quantity: string; unitPrice: string; vatRate: string; amount: string; vatAmount: string };

/** نوع الشحن الافتراضي للبيانات القديمة: كل السطور صفرية = دولي. */
const inferShipping = (lines: QuoteLineInput[]): ShippingType => (lines.every((l) => !l.vatRate) ? "international" : "domestic");

async function routeNames(db: Db | Tx, ids: number[]) {
  if (!ids.length) return new Map<number, string>();
  const rows = await db.execute(
    sql`select r.id, a.name_ar || ' ← ' || b.name_ar as name from routes r join locations a on a.id = r.from_location_id join locations b on b.id = r.to_location_id where r.id in ${ids}`,
  );
  return new Map((rows as unknown as { id: number; name: string }[]).map((r) => [Number(r.id), r.name]));
}

async function buildLines(db: Db | Tx, lines: QuoteLineInput[], shipping: ShippingType): Promise<BuiltLine[]> {
  const used = lines.filter((l) => l.description.trim() || l.routeId);
  if (!used.length) throw new Error("أضف بنداً واحداً على الأقل");
  const names = await routeNames(db, used.map((l) => l.routeId).filter((x): x is number => !!x));
  return used.map((l, i) => {
    if (!(l.quantity > 0)) throw new Error(`البند ${i + 1}: الكمية إلزامية`);
    if (!(l.unitPrice > 0)) throw new Error(`البند ${i + 1}: السعر إلزامي`);
    const vatRate = l.vatRate ?? SHIPPING_TYPES[shipping].vat;
    if (![0, 15].includes(vatRate)) throw new Error(`البند ${i + 1}: الضريبة 15% أو صفر`);
    const amount = round2(l.quantity * l.unitPrice);
    return {
      lineNo: i + 1,
      routeId: l.routeId ?? null,
      description: l.description.trim() || `نقل ${names.get(l.routeId!) ?? ""}`.trim(),
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
      vatRate: String(vatRate),
      amount: String(amount),
      vatAmount: String(round2((amount * vatRate) / 100)),
    };
  });
}

const totalsOf = (lines: { amount: string; vatAmount: string }[]) => {
  const subtotal = round2(lines.reduce((t, l) => t + Number(l.amount), 0));
  const vat = round2(lines.reduce((t, l) => t + Number(l.vatAmount), 0));
  return { subtotal: String(subtotal), vatTotal: String(vat), total: String(round2(subtotal + vat)) };
};

function checkHeader(input: Pick<QuoteInput, "customerId" | "date" | "validUntil">) {
  if (!input.customerId) throw new Error("اختر العميل");
  if (!input.date) throw new Error("التاريخ إلزامي");
  if (!input.validUntil) throw new Error("تاريخ الصلاحية إلزامي");
  if (input.validUntil < input.date) throw new Error("تاريخ انتهاء العرض قبل تاريخه");
}

export async function createQuotation(db: Db, input: QuoteInput) {
  return db.transaction((tx) => createQuotationTx(tx, input));
}

/** إنشاء العرض داخل معاملة قائمة (الاستيراد من Excel). */
export async function createQuotationTx(tx: Tx, input: QuoteInput) {
  checkHeader(input);
  const shippingType = input.shippingType ?? inferShipping(input.lines);
  const lines = await buildLines(tx, input.lines, shippingType);
  const number = await nextDocumentNumber(tx, "quotation", "QT", Number(input.date.slice(0, 4)));
  const [q] = await tx
    .insert(s.quotations)
    .values({
      number,
      quoteDate: input.date,
      validUntil: input.validUntil,
      customerId: input.customerId,
      currencyCode: input.currencyCode || "SAR",
      shippingType,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      terms: input.terms?.trim() || null,
      createdBy: input.userId ?? null,
      ...totalsOf(lines),
    })
    .returning();
  await tx.insert(s.quotationLines).values(lines.map((l) => ({ ...l, quotationId: q.id })));
  return q;
}

async function lockQuote(tx: Tx, id: number) {
  const [q] = await tx.select().from(s.quotations).where(eq(s.quotations.id, id)).for("update");
  if (!q) throw new Error("العرض غير موجود");
  return q;
}

/** العرض يُعدّل ما لم يتحول لفاتورة أو يُلغَ. */
function assertEditable(q: typeof s.quotations.$inferSelect) {
  if (q.salesInvoiceId) throw new Error(`العرض ${q.number} تحوّل لفاتورة؛ عدّل الفاتورة بدلاً منه`);
  if (q.status === "cancelled") throw new Error(`العرض ${q.number} ملغى؛ أعده لمسودة أولاً`);
}

/** تعديل العرض كاملاً من نافذة التعديل: الرأس والبنود معاً. */
export async function updateQuotation(db: Db, id: number, input: Omit<QuoteInput, "userId">) {
  checkHeader(input);
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    assertEditable(q);
    const shippingType = input.shippingType ?? q.shippingType;
    const lines = await buildLines(tx, input.lines, shippingType);
    await tx.delete(s.quotationLines).where(eq(s.quotationLines.quotationId, id));
    await tx.insert(s.quotationLines).values(lines.map((l) => ({ ...l, quotationId: id })));
    const [row] = await tx
      .update(s.quotations)
      .set({
        quoteDate: input.date,
        validUntil: input.validUntil,
        customerId: input.customerId,
        currencyCode: input.currencyCode || q.currencyCode,
        shippingType,
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        terms: input.terms?.trim() || null,
        ...totalsOf(lines),
        updatedAt: new Date(),
      })
      .where(eq(s.quotations.id, id))
      .returning();
    return row;
  });
}

export interface QuoteSheetPatch {
  header: Partial<{ date: string; validUntil: string; customerId: number; currencyCode: string; shippingType: ShippingType; reference: string; notes: string; terms: string }>;
  lines: Record<number, Partial<{ routeId: number | null; description: string; quantity: number; unitPrice: number; vatRate: number }>>;
}

/**
 * تعديل من الورقة: خلايا الرأس وخلايا البنود الموجودة. تغيير نوع الشحن ينقل ضريبة البنود
 * التي كانت على ضريبة النوع السابق، ويُترك ما عُدّل يدوياً.
 */
export async function updateQuotationFromSheet(db: Db, id: number, patch: QuoteSheetPatch) {
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    assertEditable(q);
    const current = await tx.select().from(s.quotationLines).where(eq(s.quotationLines.quotationId, id)).orderBy(asc(s.quotationLines.lineNo));
    for (const lineId of Object.keys(patch.lines)) if (!current.some((l) => l.id === Number(lineId))) throw new Error("بند غير موجود في العرض");
    const h = patch.header;
    const shippingType = h.shippingType ?? q.shippingType;
    const oldVat = SHIPPING_TYPES[q.shippingType].vat;
    const merged: QuoteLineInput[] = current.map((l) => {
      const p = patch.lines[l.id] ?? {};
      const vat = p.vatRate ?? (Number(l.vatRate) === oldVat ? null : Number(l.vatRate));
      return {
        routeId: p.routeId !== undefined ? p.routeId : l.routeId,
        description: p.description ?? l.description,
        quantity: p.quantity ?? Number(l.quantity),
        unitPrice: p.unitPrice ?? Number(l.unitPrice),
        vatRate: vat,
      };
    });
    const header = { customerId: h.customerId ?? q.customerId, date: h.date ?? q.quoteDate, validUntil: h.validUntil ?? q.validUntil };
    checkHeader(header);
    const lines = await buildLines(tx, merged, shippingType);
    for (const [i, l] of current.entries()) {
      const b = lines[i];
      await tx
        .update(s.quotationLines)
        .set({ routeId: b.routeId, description: b.description, quantity: b.quantity, unitPrice: b.unitPrice, vatRate: b.vatRate, amount: b.amount, vatAmount: b.vatAmount })
        .where(eq(s.quotationLines.id, l.id));
    }
    await tx
      .update(s.quotations)
      .set({
        quoteDate: header.date,
        validUntil: header.validUntil,
        customerId: header.customerId,
        currencyCode: h.currencyCode ?? q.currencyCode,
        shippingType,
        ...(h.reference !== undefined ? { reference: h.reference.trim() || null } : {}),
        ...(h.notes !== undefined ? { notes: h.notes.trim() || null } : {}),
        ...(h.terms !== undefined ? { terms: h.terms.trim() || null } : {}),
        ...totalsOf(lines),
        updatedAt: new Date(),
      })
      .where(eq(s.quotations.id, id));
  });
}

/** تعديل رأس عرض المسودة من الورقة: التاريخ والصلاحية والملاحظات والشروط. */
export async function updateDraftQuotation(db: Db, id: number, patch: { date?: string; validUntil?: string; notes?: string; terms?: string }) {
  return updateQuotationFromSheet(db, id, { header: patch, lines: {} });
}

export async function setQuotationStatus(db: Db, id: number, status: QuoteStatus) {
  if (!(status in QUOTE_STATUS)) throw new Error("حالة غير معروفة");
  await db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    if (q.salesInvoiceId) throw new Error(`العرض ${q.number} تحوّل لفاتورة؛ احذف الفاتورة المسودة أولاً`);
    if (q.status === status) return;
    await tx.update(s.quotations).set({ status, updatedAt: new Date() }).where(eq(s.quotations.id, id));
  });
}

export async function deleteQuotation(db: Db, id: number) {
  await db.transaction(async (tx) => {
    const [q] = await tx.select().from(s.quotations).where(eq(s.quotations.id, id)).for("update");
    if (!q) return;
    if (q.salesInvoiceId) throw new Error(`العرض ${q.number} تحوّل لفاتورة؛ احذف الفاتورة المسودة أولاً`);
    await tx.delete(s.quotations).where(eq(s.quotations.id, id));
  });
}

/** نسخة جديدة مسودة من عرض بنفس العميل والبنود، بتاريخ اليوم ونفس مدة الصلاحية. */
export async function duplicateQuotation(db: Db, id: number, input: { date: string; userId?: number }) {
  const doc = await quotationDoc(db, id);
  if (!doc) throw new Error("العرض غير موجود");
  const days = Math.max(0, Math.round((Date.parse(doc.q.validUntil) - Date.parse(doc.q.quoteDate)) / 86_400_000));
  const until = new Date(`${input.date}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  return createQuotation(db, {
    date: input.date,
    validUntil: until.toISOString().slice(0, 10),
    customerId: doc.q.customerId,
    currencyCode: doc.q.currencyCode,
    shippingType: doc.q.shippingType,
    reference: doc.q.reference,
    notes: doc.q.notes,
    terms: doc.q.terms,
    userId: input.userId,
    lines: doc.lines.map((l) => ({ routeId: l.routeId, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), vatRate: Number(l.vatRate) })),
  });
}

/** فاتورة مبيعات مسودة من العرض، بنفس البنود والأسعار، ويُعلَّم العرض مقبولاً. */
export async function quotationToInvoice(db: Db, id: number, input: { invoiceDate: string; userId?: number }) {
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    if (q.salesInvoiceId) throw new Error("تحوّل العرض لفاتورة مسبقاً");
    if (q.status === "cancelled" || q.status === "rejected") throw new Error(`العرض ${QUOTE_STATUS[q.status].label}؛ أعده لمسودة أولاً`);
    if (!input.invoiceDate) throw new Error("تاريخ الفاتورة إلزامي");
    const lines = await tx.select({ l: s.quotationLines, intl: s.routes.isInternational }).from(s.quotationLines).leftJoin(s.routes, eq(s.routes.id, s.quotationLines.routeId)).where(eq(s.quotationLines.quotationId, id)).orderBy(asc(s.quotationLines.lineNo));
    const accounts = await tx.select({ id: s.accounts.id, code: s.accounts.code }).from(s.accounts).where(inArray(s.accounts.code, [DOMESTIC, INTERNATIONAL]));
    const taxes = await tx.select().from(s.taxCodes).where(inArray(s.taxCodes.code, ["VAT15-OUT", "ZERO"]));
    const acc = (c: string) => accounts.find((a) => a.code === c)!.id;
    const [contract] = await tx.select({ days: s.contracts.paymentTermsDays }).from(s.contracts).where(eq(s.contracts.customerId, q.customerId)).limit(1);
    const due = new Date(`${input.invoiceDate}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + (contract?.days ?? 30));
    const inv = await createManualInvoiceTx(tx, {
      customerId: q.customerId,
      invoiceDate: input.invoiceDate,
      dueDate: due.toISOString().slice(0, 10),
      currencyCode: q.currencyCode,
      reference: q.reference ? `${q.number} · ${q.reference}` : q.number,
      notes: q.notes,
      userId: input.userId,
      lines: lines.map(({ l, intl }) => {
        // حساب الإيراد من المسار إن وُجد، وإلا من نوع الشحن مع ضريبة البند
        const international = intl ?? (q.shippingType === "international" && Number(l.vatRate) === 0);
        return {
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountPercent: 0,
          amount: Number(l.amount),
          vatAmount: Number(l.vatAmount),
          vatRate: Number(l.vatRate),
          taxCodeId: taxes.find((t) => t.code === (Number(l.vatRate) > 0 ? "VAT15-OUT" : "ZERO"))?.id ?? null,
          accountId: acc(international ? INTERNATIONAL : DOMESTIC),
          costCenterId: null,
        };
      }),
    });
    await tx.update(s.quotations).set({ status: "accepted", salesInvoiceId: inv.id, updatedAt: new Date() }).where(eq(s.quotations.id, id));
    return inv;
  });
}

export type QuoteFilter = ReturnType<typeof parseQuoteFilter>;

/** قائمة العروض بالبحث (رقم، عميل، مرجع، ملاحظات، بيان بند، مبلغ) والحالة والفترة والترتيب. */
export async function listQuotations(db: Db | Tx, f?: QuoteFilter, limit = 500) {
  const where: SQL[] = [];
  if (f?.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    const digits = f.q.replace(/[,\s]/g, "");
    where.push(
      or(
        ilike(s.quotations.number, like),
        ilike(s.parties.nameAr, like),
        ilike(s.quotations.reference, like),
        ilike(s.quotations.notes, like),
        sql`exists (select 1 from quotation_lines l where l.quotation_id = ${s.quotations.id} and l.description ilike ${like})`,
        ...(/^\d+(\.\d+)?$/.test(digits) ? [sql`${s.quotations.total}::text like ${`${digits}%`}`] : []),
      )!,
    );
  }
  if (f?.status) where.push(eq(s.quotations.status, f.status as QuoteStatus));
  if (f?.from) where.push(gte(s.quotations.quoteDate, f.from));
  if (f?.to) where.push(lte(s.quotations.quoteDate, f.to));
  const order = {
    date_desc: [desc(s.quotations.quoteDate), desc(s.quotations.id)],
    date_asc: [asc(s.quotations.quoteDate), asc(s.quotations.id)],
    amount_desc: [desc(s.quotations.total), desc(s.quotations.id)],
    amount_asc: [asc(s.quotations.total), desc(s.quotations.id)],
    number_desc: [desc(s.quotations.number)],
    party_asc: [asc(s.parties.nameAr), desc(s.quotations.quoteDate)],
  }[f?.sort ?? "date_desc"];
  return db
    .select({ q: s.quotations, customer: s.parties.nameAr, invoice: s.salesInvoices.number })
    .from(s.quotations)
    .innerJoin(s.parties, eq(s.parties.id, s.quotations.customerId))
    .leftJoin(s.salesInvoices, eq(s.salesInvoices.id, s.quotations.salesInvoiceId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(...order)
    .limit(limit);
}

/** بنود عدة عروض دفعة واحدة (للورقة المفصلة). */
export async function quotationLinesFor(db: Db | Tx, ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(s.quotationLines).where(inArray(s.quotationLines.quotationId, ids)).orderBy(asc(s.quotationLines.quotationId), asc(s.quotationLines.lineNo));
}

export async function quotationDoc(db: Db | Tx, id: number) {
  const [row] = await db.select({ q: s.quotations, customer: s.parties }).from(s.quotations).innerJoin(s.parties, eq(s.parties.id, s.quotations.customerId)).where(eq(s.quotations.id, id));
  if (!row) return null;
  const lines = await db.select().from(s.quotationLines).where(eq(s.quotationLines.quotationId, id)).orderBy(asc(s.quotationLines.lineNo));
  return { ...row, lines };
}
