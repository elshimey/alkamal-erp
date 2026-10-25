import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { nextDocumentNumber } from "@/lib/ledger";
import { createManualInvoiceTx } from "@/lib/invoices";

// عرض سعر للعميل: سطور نقل (مسار أو وصف حر) بكمية وسعر، يُرسل ويُطبع، وعند القبول يتحول لفاتورة مسودة.
export const QUOTE_STATUS = { draft: { label: "مسودة", tone: "gray" }, sent: { label: "أُرسل", tone: "blue" }, accepted: { label: "مقبول", tone: "green" }, rejected: { label: "مرفوض", tone: "red" } } as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const DOMESTIC = "4101";
const INTERNATIONAL = "4102";

export interface QuoteLineInput {
  routeId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

export interface QuoteInput {
  date: string;
  validUntil: string;
  customerId: number;
  currencyCode?: string;
  notes?: string | null;
  terms?: string | null;
  lines: QuoteLineInput[];
  userId?: number;
}

async function buildLines(db: Db, input: QuoteInput) {
  const lines = input.lines.filter((l) => l.description.trim() || l.routeId);
  if (!lines.length) throw new Error("أضف سطراً واحداً على الأقل");
  const routeIds = lines.map((l) => l.routeId).filter((x): x is number => !!x);
  const routes = routeIds.length
    ? await db.execute(
        sql`select r.id, a.name_ar || ' ← ' || b.name_ar as name from routes r join locations a on a.id = r.from_location_id join locations b on b.id = r.to_location_id where r.id in ${routeIds}`,
      )
    : [];
  const names = new Map((routes as unknown as { id: number; name: string }[]).map((r) => [Number(r.id), r.name]));
  return lines.map((l, i) => {
    if (!(l.quantity > 0)) throw new Error(`السطر ${i + 1}: الكمية إلزامية`);
    if (!(l.unitPrice > 0)) throw new Error(`السطر ${i + 1}: السعر إلزامي`);
    if (![0, 15].includes(l.vatRate)) throw new Error(`السطر ${i + 1}: الضريبة 15% أو صفر`);
    const amount = round2(l.quantity * l.unitPrice);
    return {
      lineNo: i + 1,
      routeId: l.routeId ?? null,
      description: l.description.trim() || `نقل ${names.get(l.routeId!) ?? ""}`,
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
      vatRate: String(l.vatRate),
      amount: String(amount),
      vatAmount: String(round2((amount * l.vatRate) / 100)),
    };
  });
}

const totalsOf = (lines: { amount: string; vatAmount: string }[]) => {
  const subtotal = round2(lines.reduce((t, l) => t + Number(l.amount), 0));
  const vat = round2(lines.reduce((t, l) => t + Number(l.vatAmount), 0));
  return { subtotal: String(subtotal), vatTotal: String(vat), total: String(round2(subtotal + vat)) };
};

export async function createQuotation(db: Db, input: QuoteInput) {
  if (!input.customerId) throw new Error("اختر العميل");
  if (input.validUntil < input.date) throw new Error("تاريخ انتهاء العرض قبل تاريخه");
  const lines = await buildLines(db, input);
  return db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "quotation", "QT", Number(input.date.slice(0, 4)));
    const [q] = await tx
      .insert(s.quotations)
      .values({ number, quoteDate: input.date, validUntil: input.validUntil, customerId: input.customerId, currencyCode: input.currencyCode || "SAR", notes: input.notes || null, terms: input.terms || null, createdBy: input.userId ?? null, ...totalsOf(lines) })
      .returning();
    await tx.insert(s.quotationLines).values(lines.map((l) => ({ ...l, quotationId: q.id })));
    return q;
  });
}

export async function setQuotationStatus(db: Db, id: number, status: "draft" | "sent" | "accepted" | "rejected") {
  const [q] = await db.select().from(s.quotations).where(eq(s.quotations.id, id));
  if (!q) throw new Error("العرض غير موجود");
  if (q.salesInvoiceId) throw new Error("تحوّل العرض لفاتورة؛ احذف الفاتورة المسودة أولاً");
  await db.update(s.quotations).set({ status, updatedAt: new Date() }).where(eq(s.quotations.id, id));
}

/** تعديل رأس عرض المسودة من الورقة: التاريخ والصلاحية والملاحظات والشروط. */
export async function updateDraftQuotation(db: Db, id: number, patch: { date?: string; validUntil?: string; notes?: string; terms?: string }) {
  const [q] = await db.select().from(s.quotations).where(eq(s.quotations.id, id));
  if (!q) throw new Error("العرض غير موجود");
  if (q.status !== "draft") throw new Error(`العرض ${q.number} ليس مسودة؛ لا يُعدّل`);
  const date = patch.date ?? q.quoteDate;
  const validUntil = patch.validUntil ?? q.validUntil;
  if (validUntil < date) throw new Error("تاريخ الصلاحية قبل تاريخ العرض");
  await db
    .update(s.quotations)
    .set({
      quoteDate: date,
      validUntil,
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() || null } : {}),
      ...(patch.terms !== undefined ? { terms: patch.terms.trim() || null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(s.quotations.id, id));
}

export async function deleteQuotation(db: Db, id: number) {
  const [q] = await db.select().from(s.quotations).where(eq(s.quotations.id, id));
  if (!q) return;
  if (q.salesInvoiceId) throw new Error("تحوّل العرض لفاتورة؛ احذف الفاتورة المسودة أولاً");
  await db.delete(s.quotations).where(eq(s.quotations.id, id));
}

/** فاتورة مبيعات مسودة من عرض مقبول، بنفس السطور والأسعار. */
export async function quotationToInvoice(db: Db, id: number, input: { invoiceDate: string; userId?: number }) {
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(s.quotations).where(eq(s.quotations.id, id)).for("update");
    if (!q) throw new Error("العرض غير موجود");
    if (q.salesInvoiceId) throw new Error("تحوّل العرض لفاتورة مسبقاً");
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
      reference: q.number,
      notes: q.notes,
      userId: input.userId,
      lines: lines.map(({ l, intl }) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountPercent: 0,
        amount: Number(l.amount),
        vatAmount: Number(l.vatAmount),
        vatRate: Number(l.vatRate),
        taxCodeId: taxes.find((t) => t.code === (Number(l.vatRate) > 0 ? "VAT15-OUT" : "ZERO"))?.id ?? null,
        accountId: acc(intl ? INTERNATIONAL : DOMESTIC),
        costCenterId: null,
      })),
    });
    await tx.update(s.quotations).set({ status: "accepted", salesInvoiceId: inv.id, updatedAt: new Date() }).where(eq(s.quotations.id, id));
    return inv;
  });
}

export async function listQuotations(db: Db) {
  return db
    .select({ q: s.quotations, customer: s.parties.nameAr, invoice: s.salesInvoices.number })
    .from(s.quotations)
    .innerJoin(s.parties, eq(s.parties.id, s.quotations.customerId))
    .leftJoin(s.salesInvoices, eq(s.salesInvoices.id, s.quotations.salesInvoiceId))
    .orderBy(desc(s.quotations.quoteDate), desc(s.quotations.id))
    .limit(300);
}

export async function quotationDoc(db: Db, id: number) {
  const [row] = await db.select({ q: s.quotations, customer: s.parties }).from(s.quotations).innerJoin(s.parties, eq(s.parties.id, s.quotations.customerId)).where(eq(s.quotations.id, id));
  if (!row) return null;
  const lines = await db.select().from(s.quotationLines).where(eq(s.quotationLines.quotationId, id)).orderBy(asc(s.quotationLines.lineNo));
  return { ...row, lines };
}
