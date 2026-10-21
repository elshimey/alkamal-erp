import { and, asc, desc, eq, ilike, inArray, like, or, sql, gte, lte, type SQL } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber, type LineInput } from "@/lib/ledger";
import { round2 } from "@/lib/invoice-posting";
import { rateOn } from "@/lib/waybills";
import { SALES_ACCOUNTS } from "@/data/sales";
import type { DocFilter } from "@/lib/doc-filters";

// سندات القبض على طريقة وافق:
// - دفعة عن فواتير: مدين الصندوق (والتعديلات كالخصم المسموح والرسوم البنكية) / دائن العملاء،
//   وتوزَّع على الفواتير التي يختارها المستخدم بالمبالغ التي يحددها، والباقي رصيد دائن للعميل.
// - دفعة مقدمة: مدين الصندوق / دائن دفعات مقدمة من العملاء 2112، وتُطبق لاحقاً على فواتيره.
// - استرداد: يرد للعميل من رصيده (الدفعات المقدمة أولاً ثم الرصيد الدائن) مدين / دائن الصندوق.

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));
const EPS = 0.005;

async function accountId(db: Db | Tx, code: string) {
  const [row] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!row) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return row.id;
}

export type ReceiptKind = (typeof s.receiptKind.enumValues)[number];

export interface ReceiptInput {
  kind?: ReceiptKind;
  receiptDate: string;
  customerId: number;
  amount: number;
  currencyCode?: string;
  exchangeRate?: number | null;
  method: "cash" | "transfer" | "cheque" | "card";
  cashAccountId: number;
  collector?: string | null;
  reference?: string | null;
  notes?: string | null;
  // فاتورة واحدة يُخصص عليها (من الشيت)؛ فارغ مع غياب التوزيع = الأقدم استحقاقاً
  invoiceId?: number | null;
  allocations?: { invoiceId: number; amount: number }[];
  adjustments?: { accountId: number; amount: number; description: string }[];
  post?: boolean;
  userId?: number;
}

export async function createReceipt(db: Db | Tx, input: ReceiptInput) {
  return db.transaction(async (tx) => {
    const kind = input.kind ?? "invoice_payment";
    if (!(input.amount > 0)) throw new Error("المبلغ المستلم مطلوب");
    const [cash] = await tx.select().from(s.accounts).where(eq(s.accounts.id, input.cashAccountId));
    if (!cash || !cash.isPostable || !/^110[12]/.test(cash.code)) throw new Error("اختر صندوقاً أو حساب بنك تفصيلياً");
    const currency = input.currencyCode ?? "SAR";
    if (cash.currencyCode && cash.currencyCode !== currency) throw new Error(`الحساب ${cash.nameAr} بعملة ${cash.currencyCode}`);
    const allocations = (input.allocations ?? []).filter((a) => a.amount > 0);
    const adjustments = (input.adjustments ?? []).filter((a) => a.amount > 0);
    if (kind !== "invoice_payment" && (allocations.length || adjustments.length || input.invoiceId)) throw new Error("التوزيع على الفواتير للدفعة عن فواتير فقط");
    const plan: s.ReceiptPlan | null = allocations.length || adjustments.length ? { allocations, adjustments } : input.invoiceId ? { invoiceId: input.invoiceId } : null;
    const number = await nextDocumentNumber(tx, "receipt", kind === "refund" ? "RF" : "RC", Number(input.receiptDate.slice(0, 4)));
    const [r] = await tx
      .insert(s.receipts)
      .values({
        number,
        kind,
        receiptDate: input.receiptDate,
        customerId: input.customerId,
        amount: String(input.amount),
        currencyCode: currency,
        exchangeRate: String(input.exchangeRate ?? (await rateOn(tx, currency, input.receiptDate))),
        method: input.method,
        cashAccountId: cash.id,
        collector: input.collector || null,
        reference: input.reference || null,
        notes: input.notes || null,
        plan,
        createdBy: input.userId,
      })
      .returning();
    if (input.post) await postReceiptTx(tx, r.id, { invoiceId: input.invoiceId, userId: input.userId });
    return r;
  });
}

export async function postReceipt(db: Db, receiptId: number, opts: { invoiceId?: number | null; userId?: number } = {}) {
  return db.transaction((tx) => postReceiptTx(tx, receiptId, opts));
}

/** رصيد العميل الدائن المتاح للاسترداد أو التطبيق، بالريال من القيود المرحّلة. */
export async function customerCredit(db: Db | Tx, customerId: number) {
  const [row] = await db
    .select({
      advances: sql<string>`coalesce(sum(case when ${s.accounts.code} like ${`${SALES_ACCOUNTS.customerAdvances}%`} then ${s.journalLines.creditBase} - ${s.journalLines.debitBase} end), 0)`,
      receivable: sql<string>`coalesce(sum(case when ${s.accounts.code} like ${`${SALES_ACCOUNTS.receivable}%`} then ${s.journalLines.debitBase} - ${s.journalLines.creditBase} end), 0)`,
    })
    .from(s.journalLines)
    .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalLines.entryId))
    .innerJoin(s.accounts, eq(s.accounts.id, s.journalLines.accountId))
    .where(and(eq(s.journalLines.partyId, customerId), eq(s.journalEntries.status, "posted")));
  const advances = round2(num(row.advances));
  const receivable = round2(num(row.receivable));
  return { advances, receivable, available: round2(Math.max(0, advances) + Math.max(0, -receivable)) };
}

type Alloc = { invoiceId: number; amount: number; invoiceRate?: number };

/**
 * فروق العملة المحققة (IAS 21): الفاتورة قُيدت على العميل بسعر يومها، والتحصيل يُقفلها بسعر يوم السند.
 * الفرق بالريال يُسوّى على حساب العميل مقابل 7103: ارتفاع السعر ربح، وانخفاضه خسارة.
 */
async function fxDifferenceLines(tx: Tx, allocs: Alloc[], receiptRate: number, partyId: number, receivable: number, label: string): Promise<LineInput[]> {
  const diff = round2(allocs.reduce((t, a) => t + round2(a.amount * receiptRate) - round2(a.amount * (a.invoiceRate ?? receiptRate)), 0));
  if (Math.abs(diff) < EPS) return [];
  const fx = await accountId(tx, SALES_ACCOUNTS.fxDifferences);
  const party = { currencyCode: "SAR", exchangeRate: 1, partyId };
  const amount = Math.abs(diff);
  const description = `فروق عملة محققة – ${label}`;
  return diff > 0
    ? [
        { accountId: receivable, debit: amount, ...party, description },
        { accountId: fx, credit: amount, description },
      ]
    : [
        { accountId: fx, debit: amount, description },
        { accountId: receivable, credit: amount, ...party, description },
      ];
}

/** يوزع مبلغاً على فواتير العميل: المحدد بمبالغه، أو الأقدم استحقاقاً. يعيد التوزيع الفعلي. */
async function allocate(tx: Tx, r: typeof s.receipts.$inferSelect, available: number, plan: Alloc[] | null, only: number | null) {
  const open = await tx
    .select()
    .from(s.salesInvoices)
    .where(
      and(
        eq(s.salesInvoices.customerId, r.customerId),
        eq(s.salesInvoices.status, "issued"),
        eq(s.salesInvoices.currencyCode, r.currencyCode),
        sql`${s.salesInvoices.paidAmount} < ${s.salesInvoices.total}`,
        plan ? inArray(s.salesInvoices.id, plan.length ? plan.map((a) => a.invoiceId) : [0]) : only ? eq(s.salesInvoices.id, only) : undefined,
      ),
    )
    .orderBy(asc(s.salesInvoices.dueDate), asc(s.salesInvoices.id))
    .for("update");
  const out: Alloc[] = [];
  if (plan) {
    const total = round2(plan.reduce((t, a) => t + a.amount, 0));
    if (total > available + EPS) throw new Error(`الموزع على الفواتير ${total.toLocaleString("en")} أكبر من المبلغ ${available.toLocaleString("en")}`);
    for (const a of plan) {
      const inv = open.find((i) => i.id === a.invoiceId);
      if (!inv) throw new Error("إحدى الفواتير المختارة مسددة أو ليست لهذا العميل بنفس العملة");
      const outstanding = round2(num(inv.total) - num(inv.paidAmount));
      if (a.amount > outstanding + EPS) throw new Error(`المبلغ على الفاتورة ${inv.number} أكبر من رصيدها ${outstanding.toLocaleString("en")}`);
      out.push({ invoiceId: inv.id, amount: round2(Math.min(a.amount, outstanding)), invoiceRate: num(inv.exchangeRate) });
    }
  } else {
    if (only && !open.length) throw new Error("الفاتورة المختارة مسددة أو ليست لهذا العميل بنفس العملة");
    let left = available;
    for (const inv of open) {
      if (left <= 0) break;
      const take = round2(Math.min(left, num(inv.total) - num(inv.paidAmount)));
      out.push({ invoiceId: inv.id, amount: take, invoiceRate: num(inv.exchangeRate) });
      left = round2(left - take);
    }
  }
  for (const a of out) {
    const inv = open.find((i) => i.id === a.invoiceId)!;
    await tx
      .update(s.salesInvoices)
      .set({ paidAmount: String(round2(num(inv.paidAmount) + a.amount)), updatedAt: new Date() })
      .where(eq(s.salesInvoices.id, inv.id));
  }
  return out;
}

async function postReceiptTx(tx: Tx, receiptId: number, opts: { invoiceId?: number | null; userId?: number }) {
  const [r] = await tx.select().from(s.receipts).where(eq(s.receipts.id, receiptId)).for("update");
  if (!r) throw new Error("السند غير موجود");
  if (r.status === "posted") throw new Error(`السند ${r.number} مرحّل مسبقاً`);
  const amount = num(r.amount);
  const fx = { currencyCode: r.currencyCode, exchangeRate: num(r.exchangeRate) };
  const party = { ...fx, partyId: r.customerId };
  const receivable = await accountId(tx, SALES_ACCOUNTS.receivable);
  const plan: s.ReceiptPlan = r.plan ?? {};
  const lines: LineInput[] = [];
  let unallocated = 0;
  let allocs: Alloc[] = [];

  if (r.kind === "advance") {
    lines.push(
      { accountId: r.cashAccountId, debit: amount, ...party, description: `دفعة مقدمة ${r.number}` },
      { accountId: await accountId(tx, SALES_ACCOUNTS.customerAdvances), credit: amount, ...party, description: `دفعة مقدمة ${r.number}` },
    );
    unallocated = amount;
  } else if (r.kind === "refund") {
    const credit = await customerCredit(tx, r.customerId);
    const rate = num(r.exchangeRate);
    if (round2(amount * rate) > credit.available + EPS) throw new Error(`رصيد العميل الدائن ${credit.available.toLocaleString("en")} ريال أقل من مبلغ الاسترداد`);
    // من الدفعات المقدمة أولاً ثم من الرصيد الدائن في حساب العملاء
    const fromAdvance = round2(Math.min(amount, Math.max(0, credit.advances) / rate));
    if (fromAdvance > 0) lines.push({ accountId: await accountId(tx, SALES_ACCOUNTS.customerAdvances), debit: fromAdvance, ...party, description: `استرداد ${r.number}` });
    if (amount - fromAdvance > EPS) lines.push({ accountId: receivable, debit: round2(amount - fromAdvance), ...party, description: `استرداد ${r.number}` });
    lines.push({ accountId: r.cashAccountId, credit: amount, ...party, description: `استرداد للعميل ${r.number}` });
  } else {
    const adjustments = plan.adjustments ?? [];
    for (const a of adjustments) {
      const [acc] = await tx.select().from(s.accounts).where(eq(s.accounts.id, a.accountId));
      if (!acc || !acc.isPostable || !acc.isActive) throw new Error("حساب التعديل غير صالح");
      if (/^110[123]/.test(acc.code)) throw new Error("حساب التعديل لا يكون صندوقاً أو بنكاً أو حساب العملاء");
      await tx.insert(s.receiptAdjustments).values({ receiptId: r.id, accountId: a.accountId, amount: String(round2(a.amount)), description: a.description || acc.nameAr });
      lines.push({ accountId: a.accountId, debit: round2(a.amount), ...party, description: `${a.description || acc.nameAr} – ${r.number}` });
    }
    const settled = round2(amount + adjustments.reduce((t, a) => t + a.amount, 0));
    lines.unshift({ accountId: r.cashAccountId, debit: amount, ...party, description: `قبض ${r.number}` });
    lines.push({ accountId: receivable, credit: settled, ...party, description: `قبض ${r.number}` });
    allocs = await allocate(tx, r, settled, plan.allocations?.length ? plan.allocations : null, opts.invoiceId ?? plan.invoiceId ?? null);
    unallocated = round2(settled - allocs.reduce((t, a) => t + a.amount, 0));
    lines.push(...(await fxDifferenceLines(tx, allocs, num(r.exchangeRate), r.customerId, receivable, r.number)));
  }

  const entry = await createJournalEntryTx(tx, {
    entryDate: r.receiptDate,
    description: `${r.kind === "refund" ? "سند استرداد" : "سند قبض"} ${r.number}`,
    source: { type: "receipt", id: r.id },
    post: true,
    userId: opts.userId,
    lines,
  });
  if (allocs.length) await tx.insert(s.receiptAllocations).values(allocs.map((a) => ({ receiptId: r.id, invoiceId: a.invoiceId, amount: String(a.amount) })));
  await tx.update(s.receipts).set({ status: "posted", journalEntryId: entry.id }).where(eq(s.receipts.id, r.id));
  return { entry, unallocated };
}

/** تطبيق دفعة مقدمة مرحّلة على فواتير العميل: قيد مدين 2112 / دائن العملاء بالمطبَّق. */
export async function applyAdvance(db: Db, receiptId: number, allocations: Alloc[], opts: { date: string; userId?: number }) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(s.receipts).where(eq(s.receipts.id, receiptId)).for("update");
    if (!r || r.kind !== "advance") throw new Error("السند ليس دفعة مقدمة");
    if (r.status !== "posted") throw new Error("رحّل الدفعة المقدمة أولاً");
    const plan = allocations.filter((a) => a.amount > 0);
    if (!plan.length) throw new Error("حدد الفواتير والمبالغ");
    const existing = await tx.select().from(s.receiptAllocations).where(eq(s.receiptAllocations.receiptId, r.id));
    if (plan.some((a) => existing.some((e) => e.invoiceId === a.invoiceId))) throw new Error("طُبقت هذه الدفعة على إحدى الفواتير مسبقاً");
    const remaining = round2(num(r.amount) - existing.reduce((t, a) => t + num(a.amount), 0));
    const allocs = await allocate(tx, r, remaining, plan, null);
    const total = round2(allocs.reduce((t, a) => t + a.amount, 0));
    if (opts.date < r.receiptDate) throw new Error("تاريخ التطبيق قبل تاريخ الدفعة");
    const party = { currencyCode: r.currencyCode, exchangeRate: num(r.exchangeRate), partyId: r.customerId };
    const receivable = await accountId(tx, SALES_ACCOUNTS.receivable);
    const entry = await createJournalEntryTx(tx, {
      entryDate: opts.date,
      // بلا مصدر: قيد المصدر فريد لكل سند، والتطبيق قد يتكرر؛ يُربط بالتخصيصات عبر entryId
      description: `تطبيق الدفعة المقدمة ${r.number}`,
      post: true,
      userId: opts.userId,
      lines: [
        { accountId: await accountId(tx, SALES_ACCOUNTS.customerAdvances), debit: total, ...party, description: `تطبيق ${r.number}` },
        { accountId: receivable, credit: total, ...party, description: `تطبيق ${r.number}` },
        ...(await fxDifferenceLines(tx, allocs, num(r.exchangeRate), r.customerId, receivable, r.number)),
      ],
    });
    await tx.insert(s.receiptAllocations).values(allocs.map((a) => ({ receiptId: r.id, invoiceId: a.invoiceId, amount: String(a.amount), entryId: entry.id })));
    return { entry, applied: total, remaining: round2(remaining - total) };
  });
}

/** إرجاع السند لمسودة: يلغي قيده وقيود تطبيقه والتخصيصات والتعديلات. */
export async function revertReceipt(db: Db, receiptId: number) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(s.receipts).where(eq(s.receipts.id, receiptId)).for("update");
    if (!r) throw new Error("السند غير موجود");
    if (r.status !== "posted") throw new Error("السند ليس مرحّلاً");
    const allocs = await tx.select().from(s.receiptAllocations).where(eq(s.receiptAllocations.receiptId, receiptId));
    for (const a of allocs) {
      await tx
        .update(s.salesInvoices)
        .set({ paidAmount: sql`${s.salesInvoices.paidAmount} - ${a.amount}`, updatedAt: new Date() })
        .where(eq(s.salesInvoices.id, a.invoiceId));
    }
    await tx.delete(s.receiptAllocations).where(eq(s.receiptAllocations.receiptId, receiptId));
    await tx.delete(s.receiptAdjustments).where(eq(s.receiptAdjustments.receiptId, receiptId));
    await tx.update(s.receipts).set({ status: "draft", journalEntryId: null }).where(eq(s.receipts.id, receiptId));
    for (const e of new Set(allocs.map((a) => a.entryId).filter((v): v is number => v != null))) await deleteEntryTx(tx, e);
    if (r.journalEntryId) await deleteEntryTx(tx, r.journalEntryId);
  });
}

export async function deleteReceipt(db: Db, receiptId: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(s.receipts).where(eq(s.receipts.id, receiptId)).for("update");
    if (!r) throw new Error("السند غير موجود");
    if (r.status !== "draft") throw new Error("الحذف متاح للمسودة فقط");
    await tx.insert(s.deletionLog).values({ entity: "receipt", entityId: String(receiptId), snapshot: r, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.receipts).where(eq(s.receipts.id, receiptId));
  });
}

// ───────────── القوائم والمستند ─────────────

/** فواتير العميل المُصدرة غير المسددة بالكامل، للاختيار في سند القبض. */
export async function openInvoices(db: Db | Tx, customerId: number, currencyCode?: string) {
  return db
    .select({
      id: s.salesInvoices.id,
      number: s.salesInvoices.number,
      reference: s.salesInvoices.reference,
      invoiceDate: s.salesInvoices.invoiceDate,
      dueDate: s.salesInvoices.dueDate,
      currencyCode: s.salesInvoices.currencyCode,
      total: s.salesInvoices.total,
      paid: s.salesInvoices.paidAmount,
    })
    .from(s.salesInvoices)
    .where(
      and(
        eq(s.salesInvoices.customerId, customerId),
        eq(s.salesInvoices.status, "issued"),
        sql`${s.salesInvoices.paidAmount} < ${s.salesInvoices.total}`,
        currencyCode ? eq(s.salesInvoices.currencyCode, currencyCode) : undefined,
      ),
    )
    .orderBy(asc(s.salesInvoices.dueDate), asc(s.salesInvoices.id));
}

export interface ReceiptFilter extends Pick<DocFilter, "q" | "from" | "to"> {
  kind?: ReceiptKind;
  status?: "draft" | "posted";
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
}

export async function listReceipts(db: Db | Tx, f: ReceiptFilter, limit = 500) {
  const where: (SQL | undefined)[] = [];
  if (f.q) {
    const q = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(s.receipts.number, q), ilike(s.parties.nameAr, q), ilike(s.receipts.reference, q), ilike(s.receipts.notes, q)));
  }
  if (f.kind) where.push(eq(s.receipts.kind, f.kind));
  if (f.status) where.push(eq(s.receipts.status, f.status));
  if (f.from) where.push(gte(s.receipts.receiptDate, f.from));
  if (f.to) where.push(lte(s.receipts.receiptDate, f.to));
  const order =
    f.sort === "date_asc"
      ? [asc(s.receipts.receiptDate), asc(s.receipts.id)]
      : f.sort === "amount_desc"
        ? [desc(s.receipts.amount), desc(s.receipts.id)]
        : f.sort === "amount_asc"
          ? [asc(s.receipts.amount), desc(s.receipts.id)]
          : [desc(s.receipts.receiptDate), desc(s.receipts.id)];
  return db
    .select({
      r: s.receipts,
      customer: s.parties.nameAr,
      account: s.accounts.nameAr,
      invoiceCount: sql<number>`(select count(*) from receipt_allocations a where a.receipt_id = ${s.receipts.id})::int`,
      allocated: sql<string>`coalesce((select sum(a.amount) from receipt_allocations a where a.receipt_id = ${s.receipts.id}), 0)`,
    })
    .from(s.receipts)
    .innerJoin(s.parties, eq(s.parties.id, s.receipts.customerId))
    .innerJoin(s.accounts, eq(s.accounts.id, s.receipts.cashAccountId))
    .where(and(...where))
    .orderBy(...order)
    .limit(limit);
}

/** السند بكل تفاصيله للمعاينة والطباعة. */
export async function receiptDoc(db: Db | Tx, id: number) {
  const [row] = await db
    .select({ r: s.receipts, customer: s.parties, cashAccount: s.accounts.nameAr, cashCode: s.accounts.code, entry: s.journalEntries.number })
    .from(s.receipts)
    .innerJoin(s.parties, eq(s.parties.id, s.receipts.customerId))
    .innerJoin(s.accounts, eq(s.accounts.id, s.receipts.cashAccountId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.receipts.journalEntryId))
    .where(eq(s.receipts.id, id));
  if (!row) return null;
  const [allocations, adjustments] = await Promise.all([
    db
      .select({ invoiceId: s.receiptAllocations.invoiceId, amount: s.receiptAllocations.amount, applied: sql<boolean>`${s.receiptAllocations.entryId} is not null`, number: s.salesInvoices.number, invoiceDate: s.salesInvoices.invoiceDate, total: s.salesInvoices.total, paid: s.salesInvoices.paidAmount })
      .from(s.receiptAllocations)
      .innerJoin(s.salesInvoices, eq(s.salesInvoices.id, s.receiptAllocations.invoiceId))
      .where(eq(s.receiptAllocations.receiptId, id))
      .orderBy(asc(s.salesInvoices.invoiceDate)),
    db
      .select({ amount: s.receiptAdjustments.amount, description: s.receiptAdjustments.description, code: s.accounts.code, account: s.accounts.nameAr })
      .from(s.receiptAdjustments)
      .innerJoin(s.accounts, eq(s.accounts.id, s.receiptAdjustments.accountId))
      .where(eq(s.receiptAdjustments.receiptId, id)),
  ]);
  return { ...row, allocations, adjustments };
}

/** حسابات التعديل المقترحة: الخصم المسموح به والرسوم البنكية وما في حكمها. */
export async function adjustmentAccounts(db: Db | Tx) {
  return db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr })
    .from(s.accounts)
    .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), or(like(s.accounts.code, "4105%"), like(s.accounts.code, "6108%"), like(s.accounts.code, "6112%"), like(s.accounts.code, "6113%"))))
    .orderBy(asc(s.accounts.code));
}
