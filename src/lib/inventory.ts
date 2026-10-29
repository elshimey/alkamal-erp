import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createJournalEntryTx, deleteEntryTx, nextDocumentNumber, type LineInput } from "@/lib/ledger";
import { round2 } from "@/lib/invoice-posting";
import { isExpenseAccount } from "@/data/purchases";

// المخزون بمتوسط التكلفة المرجح على مستوى الصنف:
// - الدخول من فواتير الموردين (مدين حساب المخزون 1110) أو تسوية بالزيادة.
// - الخروج إلى أوامر الصيانة بمتوسط التكلفة (مدين صيانة المركبة على مركزها / دائن المخزون) أو تسوية بالنقص.
// - التحويل بين المستودعات حركتان بلا قيد، والجرد يرحّل الفروقات كتسوية.
// لا يُسمح برصيد سالب في أي مستودع.

const num = (v: string | null | undefined) => (v == null ? 0 : Number(v));
const qty3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const INVENTORY_ACCOUNT = "1110";
export const ADJUSTMENT_ACCOUNT = "6113";

async function accountByCode(db: Db | Tx, code: string) {
  const [a] = await db.select().from(s.accounts).where(eq(s.accounts.code, code));
  if (!a) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return a;
}

// ───────────── الأصناف والمستودعات ─────────────

export interface ProductInput {
  code?: string | null;
  nameAr: string;
  nameEn?: string | null;
  kind: "stock" | "service";
  category?: string | null;
  unit?: string | null;
  barcode?: string | null;
  purchasePrice?: number;
  salePrice?: number;
  reorderLevel?: number;
  accountId?: number | null;
  notes?: string | null;
}

async function productAccount(db: Db | Tx, kind: "stock" | "service", accountId?: number | null) {
  if (!accountId) return kind === "stock" ? (await accountByCode(db, INVENTORY_ACCOUNT)).id : (await accountByCode(db, "5107")).id;
  const [a] = await db.select().from(s.accounts).where(eq(s.accounts.id, accountId));
  if (!a?.isPostable || !a.isActive) throw new Error("اختر حساباً تفصيلياً");
  if (kind === "stock" && !a.code.startsWith("11")) throw new Error("حساب الصنف المخزني من الأصول المتداولة (مخزون)");
  if (kind === "service" && !isExpenseAccount(a.code)) throw new Error("حساب الخدمة من التكاليف أو المصروفات");
  return a.id;
}

export async function createProduct(db: Db | Tx, input: ProductInput) {
  if (!input.nameAr.trim()) throw new Error("اكتب اسم الصنف");
  const accountId = await productAccount(db, input.kind, input.accountId);
  let code = input.code?.trim();
  if (!code) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int + 1` }).from(s.products);
    code = `${input.kind === "stock" ? "P" : "S"}-${String(n).padStart(4, "0")}`;
  }
  const [dup] = await db.select({ id: s.products.id }).from(s.products).where(eq(s.products.code, code));
  if (dup) throw new Error(`رمز الصنف ${code} مستخدم`);
  const [row] = await db
    .insert(s.products)
    .values({
      code,
      nameAr: input.nameAr.trim(),
      nameEn: input.nameEn?.trim() || null,
      kind: input.kind,
      category: input.category?.trim() || null,
      unit: input.unit?.trim() || "حبة",
      barcode: input.barcode?.trim() || null,
      purchasePrice: String(input.purchasePrice ?? 0),
      salePrice: String(input.salePrice ?? 0),
      reorderLevel: String(input.reorderLevel ?? 0),
      accountId,
      notes: input.notes?.trim() || null,
    })
    .returning();
  return row;
}

export async function updateProduct(db: Db, id: number, input: ProductInput & { isActive?: boolean }) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(s.products).where(eq(s.products.id, id)).for("update");
    if (!p) throw new Error("الصنف غير موجود");
    if (!input.nameAr.trim()) throw new Error("اكتب اسم الصنف");
    if (input.kind !== p.kind) {
      const [m] = await tx.select({ id: s.stockMoves.id }).from(s.stockMoves).where(eq(s.stockMoves.productId, id)).limit(1);
      if (m) throw new Error("للصنف حركات مخزنية؛ لا يتغير نوعه");
    }
    const code = input.code?.trim() || p.code;
    if (code !== p.code) {
      const [dup] = await tx.select({ id: s.products.id }).from(s.products).where(eq(s.products.code, code));
      if (dup) throw new Error(`رمز الصنف ${code} مستخدم`);
    }
    const [row] = await tx
      .update(s.products)
      .set({
        code,
        nameAr: input.nameAr.trim(),
        nameEn: input.nameEn?.trim() || null,
        kind: input.kind,
        category: input.category?.trim() || null,
        unit: input.unit?.trim() || p.unit,
        barcode: input.barcode?.trim() || null,
        purchasePrice: String(input.purchasePrice ?? num(p.purchasePrice)),
        salePrice: String(input.salePrice ?? num(p.salePrice)),
        reorderLevel: String(input.reorderLevel ?? num(p.reorderLevel)),
        accountId: await productAccount(tx, input.kind, input.accountId ?? p.accountId),
        isActive: input.isActive ?? p.isActive,
        notes: input.notes?.trim() || null,
      })
      .where(eq(s.products.id, id))
      .returning();
    return row;
  });
}

export async function createWarehouse(db: Db, input: { code?: string | null; nameAr: string; location?: string | null }) {
  if (!input.nameAr.trim()) throw new Error("اكتب اسم المستودع");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int + 1` }).from(s.warehouses);
  const code = input.code?.trim() || `WH-${String(n).padStart(2, "0")}`;
  const [dup] = await db.select({ id: s.warehouses.id }).from(s.warehouses).where(eq(s.warehouses.code, code));
  if (dup) throw new Error(`رمز المستودع ${code} مستخدم`);
  const [row] = await db.insert(s.warehouses).values({ code, nameAr: input.nameAr.trim(), location: input.location?.trim() || null }).returning();
  return row;
}

// ───────────── الأرصدة والتكلفة ─────────────

export async function onHand(db: Db | Tx, productId: number, warehouseId: number) {
  const [r] = await db
    .select({ q: sql<string>`coalesce(sum(${s.stockMoves.quantity}), 0)` })
    .from(s.stockMoves)
    .where(and(eq(s.stockMoves.productId, productId), eq(s.stockMoves.warehouseId, warehouseId)));
  return qty3(num(r.q));
}

/** متوسط التكلفة المرجح للصنف (كل المستودعات)، أو سعر الشراء إن لم يبقَ رصيد. */
export async function averageCost(db: Db | Tx, productId: number) {
  const [r] = await db
    .select({ q: sql<string>`coalesce(sum(${s.stockMoves.quantity}), 0)`, v: sql<string>`coalesce(sum(${s.stockMoves.value}), 0)` })
    .from(s.stockMoves)
    .where(eq(s.stockMoves.productId, productId));
  if (num(r.q) > 0) return Math.round((num(r.v) / num(r.q)) * 10000) / 10000;
  const [p] = await db.select({ price: s.products.purchasePrice }).from(s.products).where(eq(s.products.id, productId));
  return num(p?.price);
}

/** يقفل سطر الصنف حتى نهاية المعاملة: صرفان متزامنان من آخر الكمية لا يمران معاً، ولا يُحسب المتوسط على رصيد يتغيّر. */
async function stockProduct(tx: Tx, productId: number) {
  const [p] = await tx.select().from(s.products).where(eq(s.products.id, productId)).for("update");
  if (!p) throw new Error("الصنف غير موجود");
  if (p.kind !== "stock") throw new Error(`${p.nameAr} خدمة وليست صنفاً مخزنياً`);
  return p;
}

interface MoveInput {
  productId: number;
  warehouseId: number;
  moveDate: string;
  quantity: number;
  value: number;
  sourceType: string;
  sourceId: number;
  description?: string | null;
}

/** يضيف حركة خروج بمتوسط التكلفة بعد التأكد من كفاية الرصيد؛ يعيد قيمة الخروج (موجبة). */
async function issue(tx: Tx, m: Omit<MoveInput, "value">) {
  const p = await stockProduct(tx, m.productId);
  const have = await onHand(tx, m.productId, m.warehouseId);
  if (have < m.quantity - 1e-9) {
    const [w] = await tx.select({ name: s.warehouses.nameAr }).from(s.warehouses).where(eq(s.warehouses.id, m.warehouseId));
    throw new Error(`رصيد ${p.nameAr} في ${w?.name ?? "المستودع"} ${have} ${p.unit} فقط؛ المطلوب ${m.quantity}`);
  }
  // آخر وحدة تخرج بباقي القيمة حتى لا تبقى كسور
  const [all] = await tx
    .select({ q: sql<string>`coalesce(sum(${s.stockMoves.quantity}), 0)`, v: sql<string>`coalesce(sum(${s.stockMoves.value}), 0)` })
    .from(s.stockMoves)
    .where(eq(s.stockMoves.productId, m.productId));
  const value = qty3(num(all.q) - m.quantity) <= 0 ? round2(num(all.v)) : round2(m.quantity * (await averageCost(tx, m.productId)));
  await tx.insert(s.stockMoves).values({ ...m, quantity: String(-m.quantity), value: String(-value) });
  return { value, product: p };
}

async function receive(tx: Tx, m: MoveInput) {
  await stockProduct(tx, m.productId);
  await tx.insert(s.stockMoves).values({ ...m, quantity: String(m.quantity), value: String(round2(m.value)) });
}

/** يحذف حركات مستند ويتأكد ألا يصبح رصيد أي مستودع سالباً بعدها. */
export async function removeMovesTx(tx: Tx, sourceType: string, sourceId: number) {
  const moves = await tx.delete(s.stockMoves).where(and(eq(s.stockMoves.sourceType, sourceType), eq(s.stockMoves.sourceId, sourceId))).returning();
  for (const key of new Set(moves.map((m) => `${m.productId}|${m.warehouseId}`))) {
    const [productId, warehouseId] = key.split("|").map(Number);
    if ((await onHand(tx, productId, warehouseId)) < -1e-9) {
      const [p] = await tx.select({ name: s.products.nameAr }).from(s.products).where(eq(s.products.id, productId));
      throw new Error(`صُرف من ${p?.name ?? "الصنف"} بعد استلامه؛ أرجع الصرف أولاً`);
    }
  }
  return moves.length;
}

// ───────────── الربط بفواتير الموردين وأوامر الصيانة ─────────────

/** فاتورة مورد مرحّلة: كل سطر بصنف مخزني يدخل مستودعه بتكلفته بالريال. */
export async function receivePurchaseTx(tx: Tx, inv: { id: number; number: string; invoiceDate: string; exchangeRate: string }) {
  const lines = await tx.select().from(s.purchaseInvoiceLines).where(eq(s.purchaseInvoiceLines.invoiceId, inv.id));
  for (const l of lines) {
    if (!l.productId) continue;
    if (!l.warehouseId || !(num(l.quantity) > 0)) throw new Error(`السطر ${l.lineNo}: حدد المستودع والكمية للصنف`);
    await receive(tx, {
      productId: l.productId,
      warehouseId: l.warehouseId,
      moveDate: inv.invoiceDate,
      quantity: num(l.quantity),
      value: num(l.amount) * num(inv.exchangeRate),
      sourceType: "purchase_invoice",
      sourceId: inv.id,
      description: `فاتورة مورد ${inv.number}`,
    });
  }
}

/** صرف قطع أمر الصيانة من المستودع: يعيد سطور القيد (مدين التكلفة على المركبة / دائن المخزون). */
export async function issueForMaintenanceTx(
  tx: Tx,
  order: { id: number; number: string; orderDate: string },
  lines: (typeof s.maintenanceLines.$inferSelect)[],
  cost: { accountId: number; costCenterId: number; plate: string },
): Promise<LineInput[]> {
  const out: LineInput[] = [];
  for (const l of lines) {
    if (!l.productId) continue;
    if (!l.warehouseId) throw new Error(`البند ${l.lineNo}: حدد المستودع`);
    const quantity = num(l.quantity);
    const { value, product } = await issue(tx, { productId: l.productId, warehouseId: l.warehouseId, moveDate: order.orderDate, quantity, sourceType: "maintenance_order", sourceId: order.id, description: `أمر صيانة ${order.number} – ${cost.plate}` });
    const unit = quantity ? Math.round((value / quantity) * 1000) / 1000 : 0;
    await tx.update(s.maintenanceLines).set({ unitPrice: String(unit), amount: String(value), vatRate: "0", vatAmount: "0" }).where(eq(s.maintenanceLines.id, l.id));
    if (value > 0) {
      const desc = `${l.description} – ${cost.plate} (من المخزون)`;
      out.push({ accountId: cost.accountId, debit: value, costCenterId: cost.costCenterId, description: desc }, { accountId: product.accountId, credit: value, description: desc });
    }
  }
  return out;
}

// ───────────── مستندات المخزون: التسوية والتحويل والجرد ─────────────

export interface StockDocInput {
  kind: "adjustment" | "transfer" | "count";
  docDate: string;
  warehouseId: number;
  toWarehouseId?: number | null;
  offsetAccountId?: number | null;
  costCenterId?: number | null;
  reason?: string | null;
  lines: { productId: number; quantity?: number; unitCost?: number | null; countedQty?: number | null }[];
  post?: boolean;
  userId?: number;
}

const PREFIX = { adjustment: "ADJ", transfer: "TRF", count: "CNT" } as const;

export async function createStockDoc(db: Db | Tx, input: StockDocInput) {
  return db.transaction(async (tx) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.docDate)) throw new Error("التاريخ مطلوب");
    if (input.kind === "transfer" && (!input.toWarehouseId || input.toWarehouseId === input.warehouseId)) throw new Error("اختر مستودعاً آخر للتحويل إليه");
    if (input.kind === "adjustment" && !input.reason?.trim()) throw new Error("اكتب سبب التسوية");
    const lines: StockDocInput["lines"] = input.kind === "count" && !input.lines.length ? await countLines(tx, input.warehouseId) : input.lines;
    if (!lines.length) throw new Error("أضف صنفاً واحداً على الأقل");
    const seen = new Set<number>();
    const rows: (typeof s.stockDocLines.$inferInsert)[] = [];
    for (const [i, l] of lines.entries()) {
      await stockProduct(tx, l.productId);
      if (seen.has(l.productId)) throw new Error(`السطر ${i + 1}: الصنف مكرر`);
      seen.add(l.productId);
      const q = qty3(l.quantity ?? 0);
      if (input.kind !== "count" && !q) throw new Error(`السطر ${i + 1}: الكمية مطلوبة`);
      if (input.kind === "transfer" && q < 0) throw new Error(`السطر ${i + 1}: كمية التحويل موجبة`);
      if (l.unitCost != null && l.unitCost < 0) throw new Error(`السطر ${i + 1}: التكلفة لا تكون سالبة`);
      rows.push({
        docId: 0,
        productId: l.productId,
        quantity: String(q),
        systemQty: input.kind === "count" ? String(await onHand(tx, l.productId, input.warehouseId)) : null,
        countedQty: input.kind === "count" && l.countedQty != null ? String(qty3(l.countedQty)) : null,
        unitCost: String(l.unitCost ?? (await averageCost(tx, l.productId))),
      });
    }
    let offsetAccountId = input.offsetAccountId ?? null;
    if (input.kind !== "transfer" && !offsetAccountId) offsetAccountId = (await accountByCode(tx, ADJUSTMENT_ACCOUNT)).id;
    const number = await nextDocumentNumber(tx, `stock_${input.kind}`, PREFIX[input.kind], Number(input.docDate.slice(0, 4)));
    const [doc] = await tx
      .insert(s.stockDocs)
      .values({
        number,
        kind: input.kind,
        docDate: input.docDate,
        warehouseId: input.warehouseId,
        toWarehouseId: input.kind === "transfer" ? input.toWarehouseId! : null,
        offsetAccountId,
        costCenterId: input.costCenterId ?? null,
        reason: input.reason?.trim() || null,
        createdBy: input.userId,
      })
      .returning();
    await tx.insert(s.stockDocLines).values(rows.map((r) => ({ ...r, docId: doc.id })));
    if (input.post) await postStockDocTx(tx, doc.id, input.userId);
    return doc;
  });
}

/** رصيد افتتاحي لصنف: تسوية بالزيادة مقابل الأرباح المبقاة. */
export async function openingStockTx(tx: Tx, input: { productId: number; warehouseId: number; quantity: number; unitCost: number; date: string; userId?: number }) {
  return createStockDoc(tx, {
    kind: "adjustment",
    docDate: input.date,
    warehouseId: input.warehouseId,
    offsetAccountId: (await accountByCode(tx, "3103")).id,
    reason: "رصيد افتتاحي",
    lines: [{ productId: input.productId, quantity: input.quantity, unitCost: input.unitCost }],
    post: true,
    userId: input.userId,
  });
}

/** سطور الجرد: كل الأصناف المخزنية التي لها حركة في المستودع أو نشطة. */
async function countLines(tx: Tx, warehouseId: number) {
  const rows = await tx
    .select({ id: s.products.id })
    .from(s.products)
    .where(
      and(
        eq(s.products.kind, "stock"),
        or(eq(s.products.isActive, true), sql`exists (select 1 from stock_moves m where m.product_id = products.id and m.warehouse_id = ${warehouseId})`),
      ),
    )
    .orderBy(asc(s.products.code));
  return rows.map((r) => ({ productId: r.id }));
}

/** حفظ الكميات المعدودة في جرد مسودة. */
export async function saveCount(db: Db, docId: number, counted: Record<number, number | null>) {
  return db.transaction(async (tx) => {
    const doc = await lockDoc(tx, docId);
    if (doc.kind !== "count" || doc.status !== "draft") throw new Error("الجرد مرحّل؛ أرجعه لمسودة للتعديل");
    for (const [lineId, q] of Object.entries(counted)) {
      if (q != null && (!Number.isFinite(q) || q < 0)) throw new Error("الكمية المعدودة لا تكون سالبة");
      await tx
        .update(s.stockDocLines)
        .set({ countedQty: q == null ? null : String(qty3(q)) })
        .where(and(eq(s.stockDocLines.id, Number(lineId)), eq(s.stockDocLines.docId, docId)));
    }
  });
}

async function lockDoc(tx: Tx, id: number) {
  const [d] = await tx.select().from(s.stockDocs).where(eq(s.stockDocs.id, id)).for("update");
  if (!d) throw new Error("المستند غير موجود");
  return d;
}

async function postStockDocTx(tx: Tx, id: number, userId?: number) {
  const doc = await lockDoc(tx, id);
  if (doc.status !== "draft") throw new Error(`المستند ${doc.number} مرحّل مسبقاً`);
  const lines = await tx.select().from(s.stockDocLines).where(eq(s.stockDocLines.docId, id)).orderBy(asc(s.stockDocLines.id));
  const base = { moveDate: doc.docDate, sourceType: "stock_doc", sourceId: doc.id };
  const entry: LineInput[] = [];
  const label = { adjustment: "تسوية مخزون", transfer: "تحويل مخزون", count: "فروقات جرد" }[doc.kind];
  for (const l of lines) {
    let q = num(l.quantity);
    if (doc.kind === "count") {
      if (l.countedQty == null) continue; // لم يُعد
      q = qty3(num(l.countedQty) - (await onHand(tx, l.productId, doc.warehouseId)));
      await tx.update(s.stockDocLines).set({ quantity: String(q) }).where(eq(s.stockDocLines.id, l.id));
    }
    if (!q) continue;
    const [p] = await tx.select().from(s.products).where(eq(s.products.id, l.productId));
    const desc = `${label} ${doc.number} – ${p.nameAr}`;
    if (doc.kind === "transfer") {
      const { value } = await issue(tx, { ...base, productId: l.productId, warehouseId: doc.warehouseId, quantity: q, description: desc });
      await receive(tx, { ...base, productId: l.productId, warehouseId: doc.toWarehouseId!, quantity: q, value, description: desc });
      continue;
    }
    let value: number;
    if (q > 0) {
      value = round2(q * num(l.unitCost));
      await receive(tx, { ...base, productId: l.productId, warehouseId: doc.warehouseId, quantity: q, value, description: desc });
    } else {
      value = -(await issue(tx, { ...base, productId: l.productId, warehouseId: doc.warehouseId, quantity: -q, description: desc })).value;
    }
    if (!value) continue;
    const abs = Math.abs(value);
    entry.push(
      { accountId: p.accountId, [value > 0 ? "debit" : "credit"]: abs, description: desc },
      { accountId: doc.offsetAccountId!, [value > 0 ? "credit" : "debit"]: abs, costCenterId: doc.costCenterId, description: desc },
    );
  }
  let journalEntryId: number | null = null;
  if (entry.length) {
    const e = await createJournalEntryTx(tx, { entryDate: doc.docDate, description: `${label} ${doc.number}${doc.reason ? ` – ${doc.reason}` : ""}`, source: { type: "stock_doc", id: doc.id }, post: true, userId, lines: entry });
    journalEntryId = e.id;
  }
  await tx.update(s.stockDocs).set({ status: "posted", journalEntryId, postedBy: userId ?? null }).where(eq(s.stockDocs.id, id));
}

export async function postStockDoc(db: Db, id: number, userId?: number) {
  return db.transaction((tx) => postStockDocTx(tx, id, userId));
}

export async function revertStockDoc(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const doc = await lockDoc(tx, id);
    if (doc.status !== "posted") throw new Error("المستند ليس مرحّلاً");
    await removeMovesTx(tx, "stock_doc", id);
    await tx.update(s.stockDocs).set({ status: "draft", journalEntryId: null, postedBy: null }).where(eq(s.stockDocs.id, id));
    if (doc.journalEntryId) await deleteEntryTx(tx, doc.journalEntryId);
  });
}

export async function deleteStockDoc(db: Db, id: number, opts: { reason: string; userId?: number }) {
  if (!opts.reason.trim()) throw new Error("اكتب سبب الحذف");
  return db.transaction(async (tx) => {
    const doc = await lockDoc(tx, id);
    if (doc.status !== "draft") throw new Error("الحذف متاح للمسودة فقط");
    const lines = await tx.select().from(s.stockDocLines).where(eq(s.stockDocLines.docId, id));
    await tx.insert(s.deletionLog).values({ entity: "stock_doc", entityId: String(id), snapshot: { doc, lines }, reason: opts.reason.trim(), userId: opts.userId });
    await tx.delete(s.stockDocs).where(eq(s.stockDocs.id, id));
  });
}

// ───────────── الاستعلامات ─────────────

/** الأصناف بأرصدتها وقيمها (في مستودع أو في الكل). */
export async function listProducts(db: Db | Tx, f: { q?: string; kind?: "stock" | "service"; warehouseId?: number | null; low?: boolean } = {}) {
  const wh = f.warehouseId ? sql`and m.warehouse_id = ${f.warehouseId}` : sql``;
  const qty = sql<string>`coalesce((select sum(m.quantity) from stock_moves m where m.product_id = products.id ${wh}), 0)`;
  const totalQ = sql<string>`coalesce((select sum(m.quantity) from stock_moves m where m.product_id = products.id), 0)`;
  const totalV = sql<string>`coalesce((select sum(m.value) from stock_moves m where m.product_id = products.id), 0)`;
  const where: (SQL | undefined)[] = [];
  if (f.kind) where.push(eq(s.products.kind, f.kind));
  if (f.q) {
    const q = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(s.products.nameAr, q), ilike(s.products.code, q), ilike(s.products.category, q), ilike(s.products.barcode, q)));
  }
  const rows = await db
    .select({ p: s.products, account: s.accounts.code, qty, totalQ, totalV })
    .from(s.products)
    .innerJoin(s.accounts, eq(s.accounts.id, s.products.accountId))
    .where(and(...where))
    .orderBy(asc(s.products.code));
  const out = rows.map((r) => {
    const avg = num(r.totalQ) > 0 ? num(r.totalV) / num(r.totalQ) : num(r.p.purchasePrice);
    const q = qty3(num(r.qty));
    return { ...r, qty: q, avgCost: Math.round(avg * 10000) / 10000, value: round2(f.warehouseId ? q * avg : num(r.totalV)), low: r.p.kind === "stock" && num(r.p.reorderLevel) > 0 && q <= num(r.p.reorderLevel) };
  });
  return f.low ? out.filter((r) => r.low) : out;
}

/** رصيد كل صنف في كل مستودع. */
export async function stockByWarehouse(db: Db | Tx) {
  return (await db.execute(sql`
    select m.product_id, m.warehouse_id, sum(m.quantity) as qty, sum(m.value) as value
    from stock_moves m group by m.product_id, m.warehouse_id having sum(m.quantity) <> 0
  `)) as unknown as { product_id: number; warehouse_id: number; qty: string; value: string }[];
}

export async function listWarehouses(db: Db | Tx) {
  return db
    .select({
      w: s.warehouses,
      items: sql<number>`(select count(*) from (select m.product_id from stock_moves m where m.warehouse_id = warehouses.id group by m.product_id having sum(m.quantity) <> 0) x)::int`,
      value: sql<string>`coalesce((select sum(m.value) from stock_moves m where m.warehouse_id = warehouses.id), 0)`,
    })
    .from(s.warehouses)
    .orderBy(asc(s.warehouses.code));
}

/** كرت الصنف: الحركات بالرصيد التراكمي. */
export async function productCard(db: Db | Tx, productId: number, warehouseId?: number | null) {
  const where = [eq(s.stockMoves.productId, productId)];
  if (warehouseId) where.push(eq(s.stockMoves.warehouseId, warehouseId));
  const moves = await db
    .select({ m: s.stockMoves, warehouse: s.warehouses.nameAr })
    .from(s.stockMoves)
    .innerJoin(s.warehouses, eq(s.warehouses.id, s.stockMoves.warehouseId))
    .where(and(...where))
    .orderBy(asc(s.stockMoves.moveDate), asc(s.stockMoves.id));
  let q = 0;
  let v = 0;
  return moves.map((r) => {
    q = qty3(q + num(r.m.quantity));
    v = round2(v + num(r.m.value));
    return { ...r, balance: q, balanceValue: v };
  });
}

export const SOURCE_HREF: Record<string, (id: number) => string> = {
  purchase_invoice: (id) => `/purchases/${id}`,
  maintenance_order: (id) => `/maintenance/${id}`,
  stock_doc: (id) => `/inventory/docs?open=${id}`,
};

export async function listStockDocs(db: Db | Tx, f: { kind?: string; from?: string; to?: string } = {}) {
  const to = pgAlias(s.warehouses, "to_wh");
  const where: (SQL | undefined)[] = [];
  if (f.kind) where.push(sql`${s.stockDocs.kind} = ${f.kind}`);
  if (f.from) where.push(gte(s.stockDocs.docDate, f.from));
  if (f.to) where.push(lte(s.stockDocs.docDate, f.to));
  return db
    .select({
      d: s.stockDocs,
      warehouse: s.warehouses.nameAr,
      toWarehouse: to.nameAr,
      lines: sql<number>`(select count(*) from stock_doc_lines l where l.doc_id = stock_docs.id)::int`,
      value: sql<string>`coalesce((select sum(abs(m.value)) from stock_moves m where m.source_type = 'stock_doc' and m.source_id = stock_docs.id), 0) / (case when stock_docs.kind = 'transfer' then 2 else 1 end)`,
    })
    .from(s.stockDocs)
    .innerJoin(s.warehouses, eq(s.warehouses.id, s.stockDocs.warehouseId))
    .leftJoin(to, eq(to.id, s.stockDocs.toWarehouseId))
    .where(and(...where))
    .orderBy(desc(s.stockDocs.docDate), desc(s.stockDocs.id))
    .limit(500);
}

export async function stockDoc(db: Db | Tx, id: number) {
  const [d] = await db.select().from(s.stockDocs).where(eq(s.stockDocs.id, id));
  if (!d) return null;
  const lines = await db
    .select({ l: s.stockDocLines, code: s.products.code, name: s.products.nameAr, unit: s.products.unit })
    .from(s.stockDocLines)
    .innerJoin(s.products, eq(s.products.id, s.stockDocLines.productId))
    .where(eq(s.stockDocLines.docId, id))
    .orderBy(asc(s.products.code));
  const whs = await db.select().from(s.warehouses).where(inArray(s.warehouses.id, [d.warehouseId, d.toWarehouseId ?? d.warehouseId]));
  const [entry] = d.journalEntryId ? await db.select({ number: s.journalEntries.number }).from(s.journalEntries).where(eq(s.journalEntries.id, d.journalEntryId)) : [];
  return { d, lines, warehouse: whs.find((w) => w.id === d.warehouseId)!, toWarehouse: whs.find((w) => w.id === d.toWarehouseId) ?? null, entry: entry?.number ?? null };
}

export async function productOptions(db: Db | Tx, kind?: "stock" | "service") {
  const rows = await db
    .select({ id: s.products.id, code: s.products.code, nameAr: s.products.nameAr, kind: s.products.kind, unit: s.products.unit, price: s.products.purchasePrice, accountId: s.products.accountId })
    .from(s.products)
    .where(and(eq(s.products.isActive, true), kind ? eq(s.products.kind, kind) : undefined))
    .orderBy(asc(s.products.code));
  return rows;
}
