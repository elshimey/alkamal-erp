import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { receivePurchaseTx, removeMovesTx } from "@/lib/inventory";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber, type LineInput } from "@/lib/ledger";
import { lineVat, round2 } from "@/lib/invoice-posting";
import { rateOn } from "@/lib/waybills";
import type { DocFilter } from "@/lib/doc-filters";
import { docOrder, docWhere } from "@/lib/doc-query";
import { PAYABLE_BY_ROLE, PURCHASE_ACCOUNTS, SUPPLIER_ROLES, isExpenseAccount } from "@/data/purchases";

// المشتريات والمصروفات وسندات الصرف. كل مستند يُرحّل قيده عند الاعتماد، وكل مدين يقابله دائن
// بالمبلغ نفسه فيبقى القيد متوازناً بالريال مع أي سعر صرف.

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));

async function accountIdByCode(db: Db | Tx, code: string) {
  const [row] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!row) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return row.id;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** حساب ذمة الجهة حسب دورها (مورد، ناقل، محطة، ورشة، مخلص). */
export async function payableAccountFor(db: Db | Tx, partyId: number) {
  const roles = await db.select({ role: s.partyRoles.role }).from(s.partyRoles).where(eq(s.partyRoles.partyId, partyId));
  const hit = PAYABLE_BY_ROLE.find((p) => roles.some((r) => r.role === p.role));
  if (!hit) throw new Error("الجهة ليست مورداً ولا ناقلاً ولا محطة ولا ورشة ولا مخلصاً");
  return accountIdByCode(db, hit.code);
}

/** يتحقق أن الحساب تفصيلي ومن حسابات التكاليف أو المصروفات، ويرجعه. */
async function expenseAccount(db: Db | Tx, accountId: number) {
  const [a] = await db.select().from(s.accounts).where(eq(s.accounts.id, accountId));
  if (!a || !a.isPostable || !a.isActive) throw new Error("اختر حساباً تفصيلياً");
  if (!isExpenseAccount(a.code)) throw new Error(`الحساب ${a.code} ليس حساب تكلفة أو مصروف`);
  return a;
}

async function vehicleCostCenter(db: Db | Tx, vehicleId: number | null | undefined) {
  if (!vehicleId) return null;
  const [v] = await db.select({ cc: s.vehicles.costCenterId }).from(s.vehicles).where(eq(s.vehicles.id, vehicleId));
  if (!v) throw new Error("المركبة غير موجودة");
  return v.cc;
}

async function inputVatTaxCode(db: Db | Tx) {
  const [t] = await db.select().from(s.taxCodes).where(eq(s.taxCodes.code, "VAT15-IN"));
  return t ?? null;
}

// ───────────── فواتير الموردين ─────────────

export interface PurchaseLineInput {
  // يكفي الصنف: المخزني يُقيد على حساب المخزون ويدخل المستودع، والخدمة على حسابها
  accountId?: number | null;
  productId?: number | null;
  warehouseId?: number | null;
  quantity?: number | null;
  vehicleId?: number | null;
  costCenterId?: number | null;
  description: string;
  amount: number;
  // نسبة الضريبة: 15 أو 0
  vatRate?: number;
}

export interface PurchaseInvoiceInput {
  supplierId: number;
  supplierInvoiceNo: string;
  invoiceDate: string;
  dueDate?: string | null;
  currencyCode?: string;
  exchangeRate?: number | null;
  notes?: string | null;
  lines: PurchaseLineInput[];
  post?: boolean;
  userId?: number;
}

/** سطور قيد فاتورة المورد: مدين التكلفة وضريبة المدخلات، دائن ذمة المورد. */
export function purchasePostingLines(
  inv: { number: string; supplierInvoiceNo: string; supplierId: number | null; currencyCode: string; exchangeRate: number; payableAccountId: number },
  lines: { accountId: number; costCenterId: number | null; description: string; amount: number; vatAmount: number }[],
  inputVatAccountId: number,
  inputTaxCodeId: number | null,
): LineInput[] {
  const fx = { currencyCode: inv.currencyCode, exchangeRate: inv.exchangeRate };
  const credit = (amount: number, description: string): LineInput => ({ accountId: inv.payableAccountId, credit: amount, ...fx, partyId: inv.supplierId, description });
  const out: LineInput[] = [];
  for (const l of lines) {
    out.push({ accountId: l.accountId, debit: l.amount, ...fx, costCenterId: l.costCenterId, partyId: inv.supplierId, description: l.description }, credit(l.amount, `فاتورة ${inv.supplierInvoiceNo} – ${l.description}`));
    if (l.vatAmount > 0) {
      out.push(
        { accountId: inputVatAccountId, debit: l.vatAmount, ...fx, partyId: inv.supplierId, taxCodeId: inputTaxCodeId, description: `ضريبة مدخلات – ${l.description}` },
        credit(l.vatAmount, `ضريبة فاتورة ${inv.supplierInvoiceNo}`),
      );
    }
  }
  return out;
}

export async function createPurchaseInvoice(db: Db, input: PurchaseInvoiceInput) {
  return db.transaction(async (tx) => {
    const supplierInvoiceNo = input.supplierInvoiceNo.trim();
    if (!supplierInvoiceNo) throw new Error("رقم فاتورة المورد إلزامي");
    if (!input.lines.length) throw new Error("الفاتورة تحتاج سطراً واحداً على الأقل");
    const [dup] = await tx
      .select({ number: s.purchaseInvoices.number })
      .from(s.purchaseInvoices)
      .where(and(eq(s.purchaseInvoices.supplierId, input.supplierId), eq(s.purchaseInvoices.supplierInvoiceNo, supplierInvoiceNo)));
    if (dup) throw new Error(`فاتورة المورد ${supplierInvoiceNo} مسجلة مسبقاً (${dup.number})`);
    const [onOrder] = await tx
      .select({ number: s.maintenanceOrders.number })
      .from(s.maintenanceOrders)
      .where(and(eq(s.maintenanceOrders.supplierId, input.supplierId), eq(s.maintenanceOrders.supplierInvoiceNo, supplierInvoiceNo)));
    if (onOrder) throw new Error(`فاتورة المورد ${supplierInvoiceNo} مسجلة على أمر الصيانة ${onOrder.number}`);
    const payableAccountId = await payableAccountFor(tx, input.supplierId);
    const currency = input.currencyCode ?? "SAR";
    const rate = input.exchangeRate ?? (await rateOn(tx, currency, input.invoiceDate));
    const tax = await inputVatTaxCode(tx);

    const lines: (typeof s.purchaseInvoiceLines.$inferInsert)[] = [];
    for (const [i, l] of input.lines.entries()) {
      if (!(l.amount > 0)) throw new Error(`السطر ${i + 1}: المبلغ إلزامي`);
      const [product] = l.productId ? await tx.select().from(s.products).where(eq(s.products.id, l.productId)) : [];
      if (l.productId && !product) throw new Error(`السطر ${i + 1}: الصنف غير موجود`);
      const stock = product?.kind === "stock";
      if (stock && (!l.warehouseId || !((l.quantity ?? 0) > 0))) throw new Error(`السطر ${i + 1}: حدد المستودع والكمية للصنف ${product.nameAr}`);
      const accountId = stock ? product.accountId : (l.accountId ?? product?.accountId);
      if (!accountId) throw new Error(`السطر ${i + 1}: اختر الحساب أو الصنف`);
      const account = stock ? (await tx.select().from(s.accounts).where(eq(s.accounts.id, accountId)))[0] : await expenseAccount(tx, accountId);
      const costCenterId = l.costCenterId ?? (await vehicleCostCenter(tx, l.vehicleId));
      if (account.requiresCostCenter && !costCenterId) throw new Error(`السطر ${i + 1}: الحساب ${account.nameAr} يتطلب مركبة أو مركز تكلفة`);
      const vatRate = l.vatRate ?? 0;
      if (vatRate !== 0 && vatRate !== 15) throw new Error(`السطر ${i + 1}: الضريبة 15% أو بدون`);
      lines.push({
        invoiceId: 0,
        lineNo: i + 1,
        accountId: account.id,
        costCenterId,
        productId: product?.id ?? null,
        warehouseId: stock ? l.warehouseId! : null,
        quantity: l.quantity ? String(l.quantity) : null,
        description: l.description.trim() || product?.nameAr || account.nameAr,
        amount: String(round2(l.amount)),
        taxCodeId: vatRate ? (tax?.id ?? null) : null,
        vatRate: String(vatRate),
        vatAmount: String(lineVat(l.amount, vatRate)),
      });
    }
    const subtotal = round2(lines.reduce((a, l) => a + num(l.amount as string), 0));
    const vat = round2(lines.reduce((a, l) => a + num(l.vatAmount as string), 0));
    const dueDate = input.dueDate || addDays(input.invoiceDate, 30);
    if (dueDate < input.invoiceDate) throw new Error("تاريخ الاستحقاق قبل تاريخ الفاتورة");
    const number = await nextDocumentNumber(tx, "purchase_invoice", "PI", Number(input.invoiceDate.slice(0, 4)));
    const [inv] = await tx
      .insert(s.purchaseInvoices)
      .values({
        number,
        supplierId: input.supplierId,
        supplierInvoiceNo,
        invoiceDate: input.invoiceDate,
        dueDate,
        currencyCode: currency,
        exchangeRate: String(rate),
        payableAccountId,
        subtotal: String(subtotal),
        vatTotal: String(vat),
        total: String(round2(subtotal + vat)),
        notes: input.notes || null,
        createdBy: input.userId,
      })
      .returning();
    await tx.insert(s.purchaseInvoiceLines).values(lines.map((l) => ({ ...l, invoiceId: inv.id })));
    if (input.post) await postPurchaseInvoiceTx(tx, inv.id, input.userId);
    return inv;
  });
}

async function lockPurchase(tx: Tx, id: number) {
  const [inv] = await tx.select().from(s.purchaseInvoices).where(eq(s.purchaseInvoices.id, id)).for("update");
  if (!inv) throw new Error("الفاتورة غير موجودة");
  return inv;
}

async function postPurchaseInvoiceTx(tx: Tx, id: number, userId?: number) {
  const inv = await lockPurchase(tx, id);
  if (inv.status !== "draft") throw new Error(`الفاتورة ${inv.number} مرحّلة مسبقاً`);
  const lines = await tx.select().from(s.purchaseInvoiceLines).where(eq(s.purchaseInvoiceLines.invoiceId, id)).orderBy(asc(s.purchaseInvoiceLines.lineNo));
  const tax = await inputVatTaxCode(tx);
  const entry = await createJournalEntryTx(tx, {
    entryDate: inv.invoiceDate,
    description: `فاتورة مورد ${inv.number} (${inv.supplierInvoiceNo})`,
    source: { type: "purchase_invoice", id: inv.id },
    post: true,
    userId,
    lines: purchasePostingLines(
      { ...inv, exchangeRate: num(inv.exchangeRate) },
      lines.map((l) => ({ accountId: l.accountId, costCenterId: l.costCenterId, description: l.description, amount: num(l.amount), vatAmount: num(l.vatAmount) })),
      await accountIdByCode(tx, PURCHASE_ACCOUNTS.inputVat),
      tax?.id ?? null,
    ),
  });
  await receivePurchaseTx(tx, inv);
  await tx.update(s.purchaseInvoices).set({ status: "posted", journalEntryId: entry.id, postedBy: userId ?? null, updatedAt: new Date() }).where(eq(s.purchaseInvoices.id, id));
  return entry;
}

export async function postPurchaseInvoice(db: Db, id: number, userId?: number) {
  return db.transaction((tx) => postPurchaseInvoiceTx(tx, id, userId));
}

export async function revertPurchaseInvoice(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const inv = await lockPurchase(tx, id);
    if (inv.status !== "posted") throw new Error("الفاتورة ليست مرحّلة");
    if (num(inv.paidAmount) > 0) throw new Error("على الفاتورة سندات صرف مخصصة؛ أرجع السندات أولاً");
    await removeMovesTx(tx, "purchase_invoice", id);
    await tx.update(s.purchaseInvoices).set({ status: "draft", journalEntryId: null, postedBy: null, updatedAt: new Date() }).where(eq(s.purchaseInvoices.id, id));
    if (inv.journalEntryId) await deleteEntryTx(tx, inv.journalEntryId);
  });
}

export async function deletePurchaseInvoice(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const inv = await lockPurchase(tx, id);
    if (inv.status !== "draft") throw new Error("الحذف متاح للمسودة فقط");
    const lines = await tx.select().from(s.purchaseInvoiceLines).where(eq(s.purchaseInvoiceLines.invoiceId, id));
    await tx.insert(s.deletionLog).values({ entity: "purchase_invoice", entityId: String(id), snapshot: { invoice: inv, lines }, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.purchaseInvoices).where(eq(s.purchaseInvoices.id, id));
  });
}

// ───────────── قائمة فواتير الموردين والتعديل من الشيت ─────────────

const purchaseCols = {
  id: s.purchaseInvoices.id,
  number: s.purchaseInvoices.number,
  date: s.purchaseInvoices.invoiceDate,
  due: s.purchaseInvoices.dueDate,
  total: s.purchaseInvoices.total,
  paid: s.purchaseInvoices.paidAmount,
  status: s.purchaseInvoices.status,
  party: s.parties.nameAr,
  search: [s.purchaseInvoices.supplierInvoiceNo, s.purchaseInvoices.notes],
};

export async function listPurchaseInvoices(db: Db | Tx, f: DocFilter, limit = 500) {
  return db
    .select({
      i: s.purchaseInvoices,
      supplier: s.parties.nameAr,
      lines: sql<number>`(select count(*) from purchase_invoice_lines l where l.invoice_id = ${s.purchaseInvoices.id})::int`,
      firstLine: sql<string | null>`(select l.description from purchase_invoice_lines l where l.invoice_id = ${s.purchaseInvoices.id} order by l.line_no limit 1)`,
    })
    .from(s.purchaseInvoices)
    .innerJoin(s.parties, eq(s.parties.id, s.purchaseInvoices.supplierId))
    .where(docWhere(purchaseCols, f, "posted"))
    .orderBy(...docOrder(purchaseCols, f.sort))
    .limit(limit);
}

/** فاتورة المورد بجهتها وسطورها وحساباتها، للمعاينة والصفحة. */
export async function purchaseInvoiceDoc(db: Db | Tx, id: number) {
  const [row] = await db
    .select({ i: s.purchaseInvoices, supplier: s.parties, payable: s.accounts.nameAr, payableCode: s.accounts.code, entry: s.journalEntries.number })
    .from(s.purchaseInvoices)
    .innerJoin(s.parties, eq(s.parties.id, s.purchaseInvoices.supplierId))
    .innerJoin(s.accounts, eq(s.accounts.id, s.purchaseInvoices.payableAccountId))
    .leftJoin(s.journalEntries, eq(s.journalEntries.id, s.purchaseInvoices.journalEntryId))
    .where(eq(s.purchaseInvoices.id, id));
  if (!row) return null;
  const lines = await db
    .select({ l: s.purchaseInvoiceLines, code: s.accounts.code, account: s.accounts.nameAr, cc: s.costCenters.nameAr })
    .from(s.purchaseInvoiceLines)
    .innerJoin(s.accounts, eq(s.accounts.id, s.purchaseInvoiceLines.accountId))
    .leftJoin(s.costCenters, eq(s.costCenters.id, s.purchaseInvoiceLines.costCenterId))
    .where(eq(s.purchaseInvoiceLines.invoiceId, id))
    .orderBy(asc(s.purchaseInvoiceLines.lineNo));
  return { ...row, lines };
}

export interface DraftPurchasePatch {
  supplierInvoiceNo?: string;
  invoiceDate?: string;
  dueDate?: string;
  notes?: string | null;
}

/** تعديل مسودة فاتورة مورد من الشيت؛ تغيير التاريخ يعيد سعر الصرف لغير الريال. */
export async function updateDraftPurchase(db: Db, id: number, patch: DraftPurchasePatch) {
  return db.transaction(async (tx) => {
    const inv = await lockPurchase(tx, id);
    if (inv.status !== "draft") throw new Error(`الفاتورة ${inv.number} مرحّلة؛ أرجعها لمسودة لتعديلها`);
    for (const d of [patch.invoiceDate, patch.dueDate]) if (d !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`تاريخ غير صحيح: ${d}`);
    const invoiceDate = patch.invoiceDate ?? inv.invoiceDate;
    const dateChanged = invoiceDate !== inv.invoiceDate;
    if (dateChanged && invoiceDate.slice(0, 4) !== inv.invoiceDate.slice(0, 4)) throw new Error("لا تُنقل الفاتورة لسنة أخرى؛ احذفها وأدخلها بالتاريخ الجديد");
    const dueDate = patch.dueDate ?? (dateChanged ? addDays(invoiceDate, Math.round((Date.parse(inv.dueDate) - Date.parse(inv.invoiceDate)) / 86_400_000)) : inv.dueDate);
    if (dueDate < invoiceDate) throw new Error("تاريخ الاستحقاق قبل تاريخ الفاتورة");
    const supplierInvoiceNo = patch.supplierInvoiceNo === undefined ? inv.supplierInvoiceNo : patch.supplierInvoiceNo.trim();
    if (!supplierInvoiceNo) throw new Error("رقم فاتورة المورد إلزامي");
    if (supplierInvoiceNo !== inv.supplierInvoiceNo) {
      const [dup] = await tx
        .select({ number: s.purchaseInvoices.number })
        .from(s.purchaseInvoices)
        .where(and(eq(s.purchaseInvoices.supplierId, inv.supplierId), eq(s.purchaseInvoices.supplierInvoiceNo, supplierInvoiceNo)));
      if (dup) throw new Error(`فاتورة المورد ${supplierInvoiceNo} مسجلة مسبقاً (${dup.number})`);
    }
    const exchangeRate = dateChanged ? String(await rateOn(tx, inv.currencyCode, invoiceDate)) : inv.exchangeRate;
    await tx
      .update(s.purchaseInvoices)
      .set({ supplierInvoiceNo, invoiceDate, dueDate, exchangeRate, notes: patch.notes === undefined ? inv.notes : patch.notes?.trim() || null, updatedAt: new Date() })
      .where(eq(s.purchaseInvoices.id, id));
  });
}

// ───────────── المصروفات المباشرة ─────────────

export interface ExpenseInput {
  expenseDate: string;
  payer: "driver_custody" | "cash";
  driverId?: number | null;
  cashAccountId?: number | null;
  accountId: number;
  vehicleId?: number | null;
  waybillId?: number | null;
  description: string;
  amount: number;
  vatAmount?: number;
  currencyCode?: string;
  exchangeRate?: number | null;
  vendorName?: string | null;
  reference?: string | null;
  approve?: boolean;
  userId?: number;
}

export async function createExpense(db: Db, input: ExpenseInput) {
  return db.transaction(async (tx) => {
    if (!(input.amount > 0)) throw new Error("المبلغ إلزامي");
    const account = await expenseAccount(tx, input.accountId);
    let driverId = input.driverId ?? null;
    let vehicleId = input.vehicleId ?? null;
    if (input.waybillId) {
      const [w] = await tx.select().from(s.waybills).where(eq(s.waybills.id, input.waybillId));
      if (!w) throw new Error("الشحنة غير موجودة");
      vehicleId ??= w.vehicleId;
      if (input.payer === "driver_custody") driverId ??= w.driverId;
    }
    if (input.payer === "driver_custody" && !driverId) throw new Error("اختر السائق صاحب العهدة");
    if (input.payer === "cash") {
      const [cash] = await tx.select().from(s.accounts).where(eq(s.accounts.id, input.cashAccountId ?? 0));
      if (!cash || !cash.isPostable || !/^110[12]/.test(cash.code)) throw new Error("اختر صندوقاً أو حساب بنك تفصيلياً");
    }
    const costCenterId = await vehicleCostCenter(tx, vehicleId);
    if (account.requiresCostCenter && !costCenterId) throw new Error(`الحساب ${account.nameAr} يتطلب المركبة`);
    const vat = round2(input.vatAmount ?? 0);
    if (vat > round2(input.amount * 0.15) + 0.01) throw new Error("الضريبة أكبر من 15% من المبلغ");
    const currency = input.currencyCode ?? "SAR";
    const number = await nextDocumentNumber(tx, "expense", "EX", Number(input.expenseDate.slice(0, 4)));
    const [e] = await tx
      .insert(s.expenses)
      .values({
        number,
        expenseDate: input.expenseDate,
        payer: input.payer,
        driverId: input.payer === "driver_custody" ? driverId : null,
        cashAccountId: input.payer === "cash" ? input.cashAccountId! : null,
        accountId: account.id,
        vehicleId,
        costCenterId,
        waybillId: input.waybillId ?? null,
        description: input.description.trim() || account.nameAr,
        amount: String(round2(input.amount)),
        vatAmount: String(vat),
        currencyCode: currency,
        exchangeRate: String(input.exchangeRate ?? (await rateOn(tx, currency, input.expenseDate))),
        vendorName: input.vendorName || null,
        reference: input.reference || null,
        createdBy: input.userId,
      })
      .returning();
    if (input.approve) await approveExpenseTx(tx, e.id, input.userId);
    return e;
  });
}

async function lockExpense(tx: Tx, id: number) {
  const [e] = await tx.select().from(s.expenses).where(eq(s.expenses.id, id)).for("update");
  if (!e) throw new Error("المصروف غير موجود");
  return e;
}

async function approveExpenseTx(tx: Tx, id: number, userId?: number) {
  const e = await lockExpense(tx, id);
  if (e.status === "approved") throw new Error(`المصروف ${e.number} معتمد مسبقاً`);
  let creditAccountId = e.cashAccountId;
  if (e.payer === "driver_custody") {
    const [d] = await tx.select({ custody: s.drivers.custodyAccountId }).from(s.drivers).where(eq(s.drivers.id, e.driverId!));
    creditAccountId = d?.custody ?? null;
  }
  if (!creditAccountId) throw new Error("لا يوجد حساب عهدة لهذا السائق");
  const fx = { currencyCode: e.currencyCode, exchangeRate: num(e.exchangeRate) };
  const credit = (amount: number): LineInput => ({ accountId: creditAccountId, credit: amount, ...fx, driverId: e.driverId, waybillId: e.waybillId, description: `${e.number} – ${e.description}` });
  const amount = num(e.amount);
  const vat = num(e.vatAmount);
  const lines: LineInput[] = [
    { accountId: e.accountId, debit: amount, ...fx, costCenterId: e.costCenterId, driverId: e.driverId, waybillId: e.waybillId, description: e.description },
    credit(amount),
  ];
  if (vat > 0) {
    const tax = await inputVatTaxCode(tx);
    lines.push({ accountId: await accountIdByCode(tx, PURCHASE_ACCOUNTS.inputVat), debit: vat, ...fx, taxCodeId: tax?.id ?? null, description: `ضريبة مدخلات ${e.number}` }, credit(vat));
  }
  const entry = await createJournalEntryTx(tx, { entryDate: e.expenseDate, description: `مصروف ${e.number}`, source: { type: "expense", id: e.id }, post: true, userId, lines });
  await tx.update(s.expenses).set({ status: "approved", rejectReason: null, journalEntryId: entry.id, approvedBy: userId ?? null }).where(eq(s.expenses.id, id));
  return entry;
}

export async function approveExpense(db: Db, id: number, userId?: number) {
  return db.transaction((tx) => approveExpenseTx(tx, id, userId));
}

export async function rejectExpense(db: Db, id: number, reason: string) {
  if (!reason.trim()) throw new Error("اكتب سبب الرفض");
  return db.transaction(async (tx) => {
    const e = await lockExpense(tx, id);
    if (e.status !== "pending") throw new Error("الرفض متاح للمصروف المعلّق فقط");
    await tx.update(s.expenses).set({ status: "rejected", rejectReason: reason.trim() }).where(eq(s.expenses.id, id));
  });
}

/** يعيد المصروف المعتمد أو المرفوض إلى «بانتظار الاعتماد»، ويلغي قيده. */
export async function revertExpense(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const e = await lockExpense(tx, id);
    if (e.status === "pending") throw new Error("المصروف معلّق أصلاً");
    await tx.update(s.expenses).set({ status: "pending", rejectReason: null, journalEntryId: null, approvedBy: null }).where(eq(s.expenses.id, id));
    if (e.journalEntryId) await deleteEntryTx(tx, e.journalEntryId);
  });
}

export async function deleteExpense(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const e = await lockExpense(tx, id);
    if (e.status === "approved") throw new Error("المصروف معتمد؛ أرجعه أولاً");
    await tx.insert(s.deletionLog).values({ entity: "expense", entityId: String(id), snapshot: e, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.expenses).where(eq(s.expenses.id, id));
  });
}

// ───────────── سندات الصرف ─────────────

export interface PaymentInput {
  paymentDate: string;
  kind: "supplier" | "custody";
  partyId?: number | null;
  driverId?: number | null;
  amount: number;
  currencyCode?: string;
  exchangeRate?: number | null;
  method: "cash" | "transfer" | "cheque" | "card";
  cashAccountId: number;
  reference?: string | null;
  notes?: string | null;
  // فارغ = يُخصص على أقدم فواتير المورد استحقاقاً
  invoiceId?: number | null;
  post?: boolean;
  userId?: number;
}

export async function createPayment(db: Db, input: PaymentInput) {
  return db.transaction(async (tx) => {
    if (!(input.amount > 0)) throw new Error("المبلغ إلزامي");
    const [cash] = await tx.select().from(s.accounts).where(eq(s.accounts.id, input.cashAccountId));
    if (!cash || !cash.isPostable || !/^110[12]/.test(cash.code)) throw new Error("اختر صندوقاً أو حساب بنك تفصيلياً");
    const currency = input.currencyCode ?? "SAR";
    if (cash.currencyCode && cash.currencyCode !== currency) throw new Error(`الحساب ${cash.nameAr} بعملة ${cash.currencyCode}`);
    let debitAccountId: number;
    if (input.kind === "supplier") {
      if (!input.partyId) throw new Error("اختر المورد");
      debitAccountId = await payableAccountFor(tx, input.partyId);
      if (input.invoiceId) {
        const [inv] = await tx.select().from(s.purchaseInvoices).where(eq(s.purchaseInvoices.id, input.invoiceId));
        if (!inv || inv.supplierId !== input.partyId) throw new Error("الفاتورة المختارة ليست لهذا المورد");
        debitAccountId = inv.payableAccountId;
      }
    } else {
      if (!input.driverId) throw new Error("اختر السائق");
      const [d] = await tx.select({ custody: s.drivers.custodyAccountId }).from(s.drivers).where(eq(s.drivers.id, input.driverId));
      if (!d?.custody) throw new Error("لا يوجد حساب عهدة لهذا السائق");
      debitAccountId = d.custody;
    }
    const number = await nextDocumentNumber(tx, "payment", "PV", Number(input.paymentDate.slice(0, 4)));
    const [p] = await tx
      .insert(s.payments)
      .values({
        number,
        paymentDate: input.paymentDate,
        kind: input.kind,
        partyId: input.kind === "supplier" ? input.partyId! : null,
        driverId: input.kind === "custody" ? input.driverId! : null,
        debitAccountId,
        amount: String(round2(input.amount)),
        currencyCode: currency,
        exchangeRate: String(input.exchangeRate ?? (await rateOn(tx, currency, input.paymentDate))),
        method: input.method,
        cashAccountId: cash.id,
        reference: input.reference || null,
        notes: input.notes || null,
        createdBy: input.userId,
      })
      .returning();
    if (input.post) await postPaymentTx(tx, p.id, { invoiceId: input.invoiceId, userId: input.userId });
    return p;
  });
}

async function postPaymentTx(tx: Tx, id: number, opts: { invoiceId?: number | null; userId?: number }) {
  const [p] = await tx.select().from(s.payments).where(eq(s.payments.id, id)).for("update");
  if (!p) throw new Error("السند غير موجود");
  if (p.status === "posted") throw new Error(`السند ${p.number} مرحّل مسبقاً`);
  const amount = num(p.amount);
  const fx = { currencyCode: p.currencyCode, exchangeRate: num(p.exchangeRate) };
  const label = `صرف ${p.number}`;
  let left = amount;
  // فرق السعر بين يوم الفاتورة ويوم السداد بالريال (موجب: دفعنا أكثر مما قُيد للمورد)
  let fxDiff = 0;
  if (p.kind === "supplier" && p.partyId) {
    const open = await tx
      .select()
      .from(s.purchaseInvoices)
      .where(
        and(
          eq(s.purchaseInvoices.supplierId, p.partyId),
          eq(s.purchaseInvoices.status, "posted"),
          eq(s.purchaseInvoices.currencyCode, p.currencyCode),
          eq(s.purchaseInvoices.payableAccountId, p.debitAccountId),
          sql`${s.purchaseInvoices.paidAmount} < ${s.purchaseInvoices.total}`,
          opts.invoiceId ? eq(s.purchaseInvoices.id, opts.invoiceId) : undefined,
        ),
      )
      .orderBy(asc(s.purchaseInvoices.dueDate), asc(s.purchaseInvoices.id))
      .for("update");
    if (opts.invoiceId && !open.length) throw new Error("الفاتورة المختارة مسددة أو غير مرحّلة أو بعملة أخرى");
    for (const inv of open) {
      if (left <= 0) break;
      const take = round2(Math.min(left, num(inv.total) - num(inv.paidAmount)));
      await tx.insert(s.paymentAllocations).values({ paymentId: p.id, invoiceId: inv.id, amount: String(take) });
      fxDiff = round2(fxDiff + round2(take * num(p.exchangeRate)) - round2(take * num(inv.exchangeRate)));
      await tx.update(s.purchaseInvoices).set({ paidAmount: String(round2(num(inv.paidAmount) + take)), updatedAt: new Date() }).where(eq(s.purchaseInvoices.id, inv.id));
      left = round2(left - take);
    }
  }
  const lines: LineInput[] = [
    { accountId: p.debitAccountId, debit: amount, ...fx, partyId: p.partyId, driverId: p.driverId, description: label },
    { accountId: p.cashAccountId, credit: amount, ...fx, partyId: p.partyId, driverId: p.driverId, description: label },
  ];
  // فروق العملة المحققة (IAS 21): يُقفل رصيد المورد بالريال بسعر فاتورته، والفرق على 7103
  if (Math.abs(fxDiff) >= 0.005) {
    const fxAccount = await accountIdByCode(tx, PURCHASE_ACCOUNTS.fxDifferences);
    const sar = { currencyCode: "SAR", exchangeRate: 1, partyId: p.partyId };
    const description = `فروق عملة محققة – ${p.number}`;
    const amt = Math.abs(fxDiff);
    lines.push(
      ...(fxDiff > 0
        ? [
            { accountId: fxAccount, debit: amt, description },
            { accountId: p.debitAccountId, credit: amt, ...sar, description },
          ]
        : [
            { accountId: p.debitAccountId, debit: amt, ...sar, description },
            { accountId: fxAccount, credit: amt, description },
          ]),
    );
  }
  const entry = await createJournalEntryTx(tx, {
    entryDate: p.paymentDate,
    description: p.kind === "custody" ? `صرف عهدة ${p.number}` : `سند صرف ${p.number}`,
    source: { type: "payment", id: p.id },
    post: true,
    userId: opts.userId,
    lines,
  });
  await tx.update(s.payments).set({ status: "posted", journalEntryId: entry.id }).where(eq(s.payments.id, id));
  // الباقي يسدد أرصدة الجهة المسجلة من الشحنات (ناقل، محطة) أو يبقى دفعة مقدمة
  return { entry, unallocated: p.kind === "supplier" ? left : 0 };
}

export async function postPayment(db: Db, id: number, opts: { invoiceId?: number | null; userId?: number } = {}) {
  return db.transaction((tx) => postPaymentTx(tx, id, opts));
}

export async function revertPayment(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(s.payments).where(eq(s.payments.id, id)).for("update");
    if (!p) throw new Error("السند غير موجود");
    if (p.status !== "posted") throw new Error("السند ليس مرحّلاً");
    const allocs = await tx.select().from(s.paymentAllocations).where(eq(s.paymentAllocations.paymentId, id));
    for (const a of allocs) {
      await tx
        .update(s.purchaseInvoices)
        .set({ paidAmount: sql`${s.purchaseInvoices.paidAmount} - ${a.amount}`, updatedAt: new Date() })
        .where(eq(s.purchaseInvoices.id, a.invoiceId));
    }
    await tx.delete(s.paymentAllocations).where(eq(s.paymentAllocations.paymentId, id));
    await tx.update(s.payments).set({ status: "draft", journalEntryId: null }).where(eq(s.payments.id, id));
    if (p.journalEntryId) await deleteEntryTx(tx, p.journalEntryId);
  });
}

export async function deletePayment(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(s.payments).where(eq(s.payments.id, id)).for("update");
    if (!p) throw new Error("السند غير موجود");
    if (p.status !== "draft") throw new Error("الحذف متاح للمسودة فقط");
    await tx.insert(s.deletionLog).values({ entity: "payment", entityId: String(id), snapshot: p, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.payments).where(eq(s.payments.id, id));
  });
}

// ───────────── قوائم الاختيار والأرصدة ─────────────

/** الجهات التي يُشترى منها (مورد، ناقل، محطة، ورشة، مخلص). */
export async function supplierOptions(db: Db | Tx) {
  const rows = await db
    .selectDistinct({ id: s.parties.id, nameAr: s.parties.nameAr })
    .from(s.parties)
    .innerJoin(s.partyRoles, eq(s.partyRoles.partyId, s.parties.id))
    .where(inArray(s.partyRoles.role, SUPPLIER_ROLES))
    .orderBy(asc(s.parties.nameAr));
  return rows.map((r) => ({ value: String(r.id), label: r.nameAr }));
}

/** حسابات التكاليف والمصروفات التفصيلية لقائمة الاختيار. */
export async function expenseAccountOptions(db: Db | Tx) {
  const rows = await db
    .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr })
    .from(s.accounts)
    .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true)))
    .orderBy(asc(s.accounts.code));
  return rows.filter((a) => isExpenseAccount(a.code)).map((a) => ({ value: String(a.id), label: `${a.code} ${a.nameAr}` }));
}

/** رصيد كل جهة دائنة (ما نستحقه لها) من القيود المرحّلة على حسابات الذمم الدائنة، بالريال. */
export async function supplierBalances(db: Db | Tx) {
  const rows = (await db.execute(sql`
    select p.id, p.name_ar, sum(l.credit_base - l.debit_base) as balance
    from journal_lines l
    join journal_entries e on e.id = l.entry_id and e.status = 'posted'
    join accounts a on a.id = l.account_id
    join parties p on p.id = l.party_id
    where a.code ~ '^210[1-5]'
    group by p.id, p.name_ar
    having abs(sum(l.credit_base - l.debit_base)) > 0.005
    order by balance desc`)) as unknown as { id: number; name_ar: string; balance: string }[];
  return rows.map((r) => ({ id: Number(r.id), name: r.name_ar, balance: Number(r.balance) }));
}

/** رصيد عهدة كل سائق: موجب = عنده نقد للشركة، سالب = صرف من جيبه ويستحق تعويضاً. */
export async function custodyBalances(db: Db | Tx) {
  const rows = (await db.execute(sql`
    select d.id, e.name_ar, coalesce(sum(l.debit_base - l.credit_base), 0) as balance
    from drivers d
    join employees e on e.id = d.employee_id
    left join journal_lines l on l.account_id = d.custody_account_id
      and exists (select 1 from journal_entries je where je.id = l.entry_id and je.status = 'posted')
    group by d.id, e.name_ar
    order by e.name_ar`)) as unknown as { id: number; name_ar: string; balance: string }[];
  return rows.map((r) => ({ id: Number(r.id), name: r.name_ar, balance: Number(r.balance) }));
}
