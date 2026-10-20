import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber, type LineInput } from "@/lib/ledger";
import { lineVat, round2 } from "@/lib/invoice-posting";
import { rateOn } from "@/lib/waybills";
import { payableAccountFor } from "@/lib/purchases";
import { NOTE_KINDS, SALES_ACCOUNTS, type NoteKind } from "@/data/sales";
import { PURCHASE_ACCOUNTS, isExpenseAccount } from "@/data/purchases";
import type { DocFilter } from "@/lib/doc-filters";

// الإشعارات الدائنة والمدينة:
// - إشعار دائن للعميل: مدين الإيراد وضريبة المخرجات / دائن العملاء، ويخفض رصيد الفاتورة المرتبطة.
// - إشعار مدين للعميل: عكسه، ويزيد ذمة العميل.
// - إشعار مدين للمورد (مرتجع أو خصم): مدين ذمة المورد / دائن الحساب وضريبة المدخلات، ويخفض رصيد فاتورته.
// - إشعار دائن من المورد: عكسه، ويزيد ذمة المورد.
// ما يزيد عن رصيد الفاتورة يبقى رصيداً دائناً للجهة.

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));
const EPS = 0.005;

async function accountId(db: Db | Tx, code: string) {
  const [row] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!row) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return row.id;
}

export interface NoteLineInput {
  description: string;
  accountId: number;
  costCenterId?: number | null;
  amount: number;
  vatRate: number;
}

export interface NoteInput {
  kind: NoteKind;
  noteDate: string;
  partyId: number;
  invoiceId?: number | null;
  currencyCode?: string;
  reason: string;
  lines: NoteLineInput[];
  post?: boolean;
  userId?: number;
}

const isSales = (k: NoteKind) => NOTE_KINDS[k].side === "sales";

/** الفاتورة المرتبطة بالإشعار مع التحقق من الجهة والحالة. */
async function linkedInvoice(tx: Db | Tx, kind: NoteKind, invoiceId: number, partyId: number) {
  if (isSales(kind)) {
    const [i] = await tx.select().from(s.salesInvoices).where(eq(s.salesInvoices.id, invoiceId));
    if (!i) throw new Error("الفاتورة غير موجودة");
    if (i.customerId !== partyId) throw new Error(`الفاتورة ${i.number} لعميل آخر`);
    if (i.status !== "issued") throw new Error(`الفاتورة ${i.number} لم تُصدر بعد`);
    return { number: i.number, currencyCode: i.currencyCode, exchangeRate: num(i.exchangeRate), date: i.invoiceDate };
  }
  const [i] = await tx.select().from(s.purchaseInvoices).where(eq(s.purchaseInvoices.id, invoiceId));
  if (!i) throw new Error("الفاتورة غير موجودة");
  if (i.supplierId !== partyId) throw new Error(`الفاتورة ${i.number} لمورد آخر`);
  if (i.status !== "posted") throw new Error(`الفاتورة ${i.number} غير مرحّلة`);
  return { number: i.number, currencyCode: i.currencyCode, exchangeRate: num(i.exchangeRate), date: i.invoiceDate };
}

export async function createNote(db: Db | Tx, input: NoteInput) {
  const k = NOTE_KINDS[input.kind];
  if (!input.reason.trim()) throw new Error("اكتب سبب الإشعار");
  const lines = input.lines.filter((l) => l.amount > 0);
  if (!lines.length) throw new Error("أضف سطراً واحداً على الأقل بمبلغ");
  const run = async (tx: Tx) => {
    const inv = input.invoiceId ? await linkedInvoice(tx, input.kind, input.invoiceId, input.partyId) : null;
    if (inv && input.noteDate < inv.date) throw new Error("تاريخ الإشعار قبل تاريخ الفاتورة");
    const currency = inv?.currencyCode ?? input.currencyCode ?? "SAR";
    const rate = inv && inv.currencyCode !== "SAR" && input.noteDate === inv.date ? inv.exchangeRate : await rateOn(tx, currency, input.noteDate);
    const accounts = await tx.select().from(s.accounts).where(inArray(s.accounts.id, [...new Set(lines.map((l) => l.accountId))]));
    for (const l of lines) {
      const a = accounts.find((x) => x.id === l.accountId);
      if (!a || !a.isPostable || !a.isActive) throw new Error("اختر حساباً تفصيلياً لكل سطر");
      if (isSales(input.kind) ? a.type !== "revenue" : !isExpenseAccount(a.code)) throw new Error(`الحساب ${a.code} ${a.nameAr} لا يصلح لهذا الإشعار`);
      if (![0, 15].includes(l.vatRate)) throw new Error("نسبة الضريبة 15% أو صفر");
      if (a.requiresCostCenter && !l.costCenterId) throw new Error(`الحساب ${a.nameAr} يتطلب مركبة أو مركز تكلفة`);
    }
    const rows = lines.map((l, i) => ({ ...l, lineNo: i + 1, amount: round2(l.amount), vatAmount: lineVat(l.amount, l.vatRate) }));
    const subtotal = round2(rows.reduce((t, l) => t + l.amount, 0));
    const vatTotal = round2(rows.reduce((t, l) => t + l.vatAmount, 0));
    const number = await nextDocumentNumber(tx, `note_${input.kind}`, k.prefix, Number(input.noteDate.slice(0, 4)));
    const [note] = await tx
      .insert(s.adjustmentNotes)
      .values({
        number,
        kind: input.kind,
        noteDate: input.noteDate,
        partyId: input.partyId,
        salesInvoiceId: isSales(input.kind) ? (input.invoiceId ?? null) : null,
        purchaseInvoiceId: isSales(input.kind) ? null : (input.invoiceId ?? null),
        payableAccountId: isSales(input.kind) ? null : await payableAccountFor(tx, input.partyId),
        currencyCode: currency,
        exchangeRate: String(rate),
        reason: input.reason.trim(),
        subtotal: String(subtotal),
        vatTotal: String(vatTotal),
        total: String(round2(subtotal + vatTotal)),
        createdBy: input.userId,
      })
      .returning();
    await tx.insert(s.adjustmentNoteLines).values(
      rows.map((l) => ({ noteId: note.id, lineNo: l.lineNo, description: l.description || input.reason.trim(), accountId: l.accountId, costCenterId: l.costCenterId ?? null, amount: String(l.amount), vatRate: String(l.vatRate), vatAmount: String(l.vatAmount) })),
    );
    if (input.post) await postNoteTx(tx, note.id, input.userId);
    return note;
  };
  return db.transaction(run);
}

export async function postNote(db: Db, id: number, userId?: number) {
  return db.transaction((tx) => postNoteTx(tx, id, userId));
}

async function postNoteTx(tx: Tx, id: number, userId?: number) {
  const [n] = await tx.select().from(s.adjustmentNotes).where(eq(s.adjustmentNotes.id, id)).for("update");
  if (!n) throw new Error("الإشعار غير موجود");
  if (n.status !== "draft") throw new Error(`الإشعار ${n.number} مرحّل مسبقاً`);
  const lines = await tx.select().from(s.adjustmentNoteLines).where(eq(s.adjustmentNoteLines.noteId, id)).orderBy(asc(s.adjustmentNoteLines.lineNo));
  const k = NOTE_KINDS[n.kind];
  const sales = isSales(n.kind);
  const party = sales
    ? await accountId(tx, SALES_ACCOUNTS.receivable)
    : n.payableAccountId!;
  const vatAcc = await accountId(tx, sales ? SALES_ACCOUNTS.outputVat : PURCHASE_ACCOUNTS.inputVat);
  const [tax] = await tx.select({ id: s.taxCodes.id }).from(s.taxCodes).where(eq(s.taxCodes.code, sales ? "VAT15-OUT" : "VAT15-IN"));
  // جانب الحسابات (الإيراد/التكلفة والضريبة) مدين في إشعار العميل الدائن ومورد الدائن، ودائن في غيرهما
  const lineSide: "debit" | "credit" = n.kind === "sales_credit" || n.kind === "purchase_credit" ? "debit" : "credit";
  const partySide = lineSide === "debit" ? "credit" : "debit";
  const fx = { currencyCode: n.currencyCode, exchangeRate: num(n.exchangeRate), partyId: n.partyId };
  const out: LineInput[] = [];
  for (const l of lines) {
    out.push({ accountId: l.accountId, [lineSide]: num(l.amount), ...fx, costCenterId: l.costCenterId, description: l.description });
    if (num(l.vatAmount) > 0) out.push({ accountId: vatAcc, [lineSide]: num(l.vatAmount), ...fx, taxCodeId: tax?.id ?? null, description: `ضريبة – ${l.description}` });
  }
  out.push({ accountId: party, [partySide]: num(n.total), ...fx, description: `${k.label} ${n.number}` });
  const entry = await createJournalEntryTx(tx, { entryDate: n.noteDate, description: `${k.label} ${n.number} – ${n.reason}`, source: { type: "adjustment_note", id: n.id }, post: true, userId, lines: out });

  // الإشعار المخفِّض يُطبق على رصيد الفاتورة المرتبطة بحد أقصى رصيدها
  let applied = 0;
  if (k.reduces && (n.salesInvoiceId || n.purchaseInvoiceId)) {
    const table = sales ? s.salesInvoices : s.purchaseInvoices;
    const invId = (n.salesInvoiceId ?? n.purchaseInvoiceId)!;
    const [inv] = await tx.select({ total: table.total, paid: table.paidAmount }).from(table).where(eq(table.id, invId)).for("update");
    applied = round2(Math.max(0, Math.min(num(n.total), num(inv.total) - num(inv.paid))));
    if (applied > EPS) await tx.update(table).set({ paidAmount: sql`${table.paidAmount} + ${applied}`, updatedAt: new Date() }).where(eq(table.id, invId));
  }
  await tx.update(s.adjustmentNotes).set({ status: "posted", journalEntryId: entry.id, appliedAmount: String(applied), updatedAt: new Date() }).where(eq(s.adjustmentNotes.id, id));
  return { entry, applied };
}

export async function revertNote(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const [n] = await tx.select().from(s.adjustmentNotes).where(eq(s.adjustmentNotes.id, id)).for("update");
    if (!n) throw new Error("الإشعار غير موجود");
    if (n.status !== "posted") throw new Error("الإشعار ليس مرحّلاً");
    const applied = num(n.appliedAmount);
    if (applied > EPS) {
      const table = n.salesInvoiceId ? s.salesInvoices : s.purchaseInvoices;
      const invId = (n.salesInvoiceId ?? n.purchaseInvoiceId)!;
      const [inv] = await tx.select({ paid: table.paidAmount }).from(table).where(eq(table.id, invId)).for("update");
      if (num(inv.paid) + EPS < applied) throw new Error("رصيد الفاتورة تغير؛ أرجع السندات المخصصة لها أولاً");
      await tx.update(table).set({ paidAmount: sql`${table.paidAmount} - ${applied}`, updatedAt: new Date() }).where(eq(table.id, invId));
    }
    await tx.update(s.adjustmentNotes).set({ status: "draft", journalEntryId: null, appliedAmount: "0", updatedAt: new Date() }).where(eq(s.adjustmentNotes.id, id));
    if (n.journalEntryId) await deleteEntryTx(tx, n.journalEntryId);
  });
}

export async function deleteNote(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const [n] = await tx.select().from(s.adjustmentNotes).where(eq(s.adjustmentNotes.id, id)).for("update");
    if (!n) throw new Error("الإشعار غير موجود");
    if (n.status !== "draft") throw new Error("الحذف متاح للمسودة فقط");
    const lines = await tx.select().from(s.adjustmentNoteLines).where(eq(s.adjustmentNoteLines.noteId, id));
    await tx.insert(s.deletionLog).values({ entity: "adjustment_note", entityId: String(id), snapshot: { note: n, lines }, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.adjustmentNotes).where(eq(s.adjustmentNotes.id, id));
  });
}

// ───────────── القوائم والمستند ─────────────

export interface NoteFilter extends Pick<DocFilter, "q" | "from" | "to"> {
  side: "sales" | "purchase";
  kind?: NoteKind;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
}

export async function listNotes(db: Db | Tx, f: NoteFilter, limit = 500) {
  const kinds = (Object.keys(NOTE_KINDS) as NoteKind[]).filter((k) => NOTE_KINDS[k].side === f.side);
  const where: (SQL | undefined)[] = [inArray(s.adjustmentNotes.kind, f.kind && kinds.includes(f.kind) ? [f.kind] : kinds)];
  if (f.q) {
    const q = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(s.adjustmentNotes.number, q), ilike(s.parties.nameAr, q), ilike(s.adjustmentNotes.reason, q)));
  }
  if (f.from) where.push(gte(s.adjustmentNotes.noteDate, f.from));
  if (f.to) where.push(lte(s.adjustmentNotes.noteDate, f.to));
  const order =
    f.sort === "date_asc"
      ? [asc(s.adjustmentNotes.noteDate), asc(s.adjustmentNotes.id)]
      : f.sort === "amount_desc"
        ? [desc(s.adjustmentNotes.total)]
        : f.sort === "amount_asc"
          ? [asc(s.adjustmentNotes.total)]
          : [desc(s.adjustmentNotes.noteDate), desc(s.adjustmentNotes.id)];
  return db
    .select({
      n: s.adjustmentNotes,
      party: s.parties.nameAr,
      invoice: sql<string | null>`coalesce(${s.salesInvoices.number}, ${s.purchaseInvoices.number})`,
    })
    .from(s.adjustmentNotes)
    .innerJoin(s.parties, eq(s.parties.id, s.adjustmentNotes.partyId))
    .leftJoin(s.salesInvoices, eq(s.salesInvoices.id, s.adjustmentNotes.salesInvoiceId))
    .leftJoin(s.purchaseInvoices, eq(s.purchaseInvoices.id, s.adjustmentNotes.purchaseInvoiceId))
    .where(and(...where))
    .orderBy(...order)
    .limit(limit);
}

export async function noteDoc(db: Db | Tx, id: number) {
  const [row] = await db
    .select({
      n: s.adjustmentNotes,
      party: s.parties,
      entry: s.journalEntries.number,
      invoice: sql<string | null>`coalesce(${s.salesInvoices.number}, ${s.purchaseInvoices.number})`,
      invoiceDate: sql<string | null>`coalesce(${s.salesInvoices.invoiceDate}, ${s.purchaseInvoices.invoiceDate})`,
      supplierInvoiceNo: s.purchaseInvoices.supplierInvoiceNo,
    })
    .from(s.adjustmentNotes)
    .innerJoin(s.parties, eq(s.parties.id, s.adjustmentNotes.partyId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.adjustmentNotes.journalEntryId))
    .leftJoin(s.salesInvoices, eq(s.salesInvoices.id, s.adjustmentNotes.salesInvoiceId))
    .leftJoin(s.purchaseInvoices, eq(s.purchaseInvoices.id, s.adjustmentNotes.purchaseInvoiceId))
    .where(eq(s.adjustmentNotes.id, id));
  if (!row) return null;
  const lines = await db
    .select({ l: s.adjustmentNoteLines, code: s.accounts.code, account: s.accounts.nameAr })
    .from(s.adjustmentNoteLines)
    .innerJoin(s.accounts, eq(s.accounts.id, s.adjustmentNoteLines.accountId))
    .where(eq(s.adjustmentNoteLines.noteId, id))
    .orderBy(asc(s.adjustmentNoteLines.lineNo));
  return { ...row, lines };
}

/** سطور الفاتورة لتعبئة الإشعار منها (مرتجع كامل أو جزئي). */
export async function invoiceLinesForNote(db: Db | Tx, side: "sales" | "purchase", invoiceId: number) {
  const t = side === "sales" ? s.salesInvoiceLines : s.purchaseInvoiceLines;
  const lines = await db.select({ description: t.description, accountId: t.accountId, costCenterId: t.costCenterId, amount: t.amount, vatRate: t.vatRate }).from(t).where(eq(t.invoiceId, invoiceId)).orderBy(asc(t.lineNo));
  return lines.map((l) => ({ ...l, amount: num(l.amount), vatRate: num(l.vatRate) }));
}
