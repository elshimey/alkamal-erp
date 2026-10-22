import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { nextDocumentNumber } from "@/lib/ledger";
import { createPurchaseInvoice } from "@/lib/purchases";

// دورة الشراء: طلب شراء داخلي (قطع، إطارات...) ← اعتماد ← أمر شراء للمورد بالأسعار ← اعتماد ← فاتورة مورد مسودة.
// لا قيود قبل فاتورة المورد؛ الطلب والأمر مستندات تشغيلية للرقابة على الشراء.

export const PR_STATUS = { draft: { label: "مسودة", tone: "gray" }, approved: { label: "معتمد", tone: "blue" }, rejected: { label: "مرفوض", tone: "red" }, ordered: { label: "صدر له أمر شراء", tone: "green" } } as const;
export const PO_STATUS = { draft: { label: "مسودة", tone: "gray" }, approved: { label: "معتمد", tone: "blue" }, invoiced: { label: "فُوتر", tone: "green" }, cancelled: { label: "ملغى", tone: "red" } } as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface RequestLineInput {
  productId?: number | null;
  description: string;
  quantity: number;
  estimatedPrice?: number | null;
}

export async function createPurchaseRequest(db: Db, input: { date: string; neededBy?: string | null; vehicleId?: number | null; notes?: string | null; lines: RequestLineInput[]; userId?: number }) {
  return db.transaction(async (tx) => {
    const lines = input.lines.filter((l) => l.description.trim() || l.productId);
    if (!lines.length) throw new Error("أضف صنفاً واحداً على الأقل");
    for (const [i, l] of lines.entries()) if (!(l.quantity > 0)) throw new Error(`السطر ${i + 1}: الكمية إلزامية`);
    const products = await productMap(tx as unknown as Db, lines);
    const number = await nextDocumentNumber(tx, "purchase_request", "PR", Number(input.date.slice(0, 4)));
    const [pr] = await tx
      .insert(s.purchaseRequests)
      .values({ number, requestDate: input.date, neededBy: input.neededBy || null, vehicleId: input.vehicleId ?? null, notes: input.notes || null, createdBy: input.userId ?? null })
      .returning();
    await tx.insert(s.purchaseRequestLines).values(
      lines.map((l, i) => ({
        requestId: pr.id,
        lineNo: i + 1,
        productId: l.productId ?? null,
        description: l.description.trim() || products.get(l.productId!)!.nameAr,
        quantity: String(l.quantity),
        estimatedPrice: l.estimatedPrice == null ? null : String(l.estimatedPrice),
      })),
    );
    return pr;
  });
}

async function productMap(db: Db, lines: { productId?: number | null }[]) {
  const ids = lines.map((l) => l.productId).filter((x): x is number => !!x);
  const rows = ids.length ? await db.select().from(s.products).where(inArray(s.products.id, ids)) : [];
  if (rows.length !== new Set(ids).size) throw new Error("صنف غير موجود");
  return new Map(rows.map((p) => [p.id, p]));
}

export async function decideRequest(db: Db, id: number, decision: "approve" | "reject" | "reopen", opts: { reason?: string; userId?: number } = {}) {
  const [pr] = await db.select().from(s.purchaseRequests).where(eq(s.purchaseRequests.id, id));
  if (!pr) throw new Error("الطلب غير موجود");
  if (pr.status === "ordered") throw new Error("صدر أمر شراء لهذا الطلب");
  if (decision === "reject" && !opts.reason?.trim()) throw new Error("اكتب سبب الرفض");
  const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "draft";
  await db
    .update(s.purchaseRequests)
    .set({ status, approvedBy: decision === "approve" ? (opts.userId ?? null) : null, rejectReason: decision === "reject" ? opts.reason!.trim() : null })
    .where(eq(s.purchaseRequests.id, id));
}

export async function deleteRequest(db: Db, id: number) {
  const [pr] = await db.select().from(s.purchaseRequests).where(eq(s.purchaseRequests.id, id));
  if (!pr) return;
  if (pr.status === "ordered" || pr.status === "approved") throw new Error("أرجع الطلب لمسودة أو احذف أمر الشراء أولاً");
  await db.delete(s.purchaseRequests).where(eq(s.purchaseRequests.id, id));
}

export interface OrderLineInput {
  productId?: number | null;
  accountId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number;
}

export async function createPurchaseOrder(
  db: Db,
  input: { date: string; supplierId: number; expectedDate?: string | null; requestId?: number | null; vehicleId?: number | null; currencyCode?: string; notes?: string | null; lines: OrderLineInput[]; userId?: number },
) {
  return db.transaction(async (tx) => {
    if (!input.supplierId) throw new Error("اختر المورد");
    const lines = input.lines.filter((l) => l.description.trim() || l.productId);
    if (!lines.length) throw new Error("أضف صنفاً واحداً على الأقل");
    const products = await productMap(tx as unknown as Db, lines);
    for (const [i, l] of lines.entries()) {
      if (!(l.quantity > 0)) throw new Error(`السطر ${i + 1}: الكمية إلزامية`);
      if (!(l.unitPrice >= 0)) throw new Error(`السطر ${i + 1}: السعر غير صحيح`);
      if (!l.productId && !l.accountId) throw new Error(`السطر ${i + 1}: اختر الصنف أو حساب المصروف`);
    }
    let vehicleId = input.vehicleId ?? null;
    if (input.requestId) {
      const [pr] = await tx.select().from(s.purchaseRequests).where(eq(s.purchaseRequests.id, input.requestId)).for("update");
      if (!pr || pr.status !== "approved") throw new Error("طلب الشراء غير معتمد أو صدر له أمر");
      vehicleId ??= pr.vehicleId;
      await tx.update(s.purchaseRequests).set({ status: "ordered" }).where(eq(s.purchaseRequests.id, pr.id));
    }
    const number = await nextDocumentNumber(tx, "purchase_order", "PO", Number(input.date.slice(0, 4)));
    const [po] = await tx
      .insert(s.purchaseOrders)
      .values({ number, orderDate: input.date, expectedDate: input.expectedDate || null, supplierId: input.supplierId, requestId: input.requestId ?? null, vehicleId, currencyCode: input.currencyCode || "SAR", notes: input.notes || null, createdBy: input.userId ?? null })
      .returning();
    await tx.insert(s.purchaseOrderLines).values(
      lines.map((l, i) => ({
        orderId: po.id,
        lineNo: i + 1,
        productId: l.productId ?? null,
        accountId: l.productId ? null : (l.accountId ?? null),
        description: l.description.trim() || products.get(l.productId!)!.nameAr,
        quantity: String(l.quantity),
        unitPrice: String(l.unitPrice),
        vatRate: String(l.vatRate ?? 15),
      })),
    );
    return po;
  });
}

/** أمر شراء من طلب معتمد: نفس السطور بالسعر التقديري أو سعر شراء الصنف. */
export async function requestToOrderLines(db: Db, requestId: number): Promise<OrderLineInput[]> {
  const rows = await db.select({ l: s.purchaseRequestLines, p: s.products }).from(s.purchaseRequestLines).leftJoin(s.products, eq(s.products.id, s.purchaseRequestLines.productId)).where(eq(s.purchaseRequestLines.requestId, requestId)).orderBy(asc(s.purchaseRequestLines.lineNo));
  return rows.map(({ l, p }) => ({ productId: l.productId, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.estimatedPrice ?? p?.purchasePrice ?? 0) }));
}

export async function setOrderStatus(db: Db, id: number, status: "approved" | "draft" | "cancelled", userId?: number) {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(s.purchaseOrders).where(eq(s.purchaseOrders.id, id)).for("update");
    if (!po) throw new Error("أمر الشراء غير موجود");
    if (po.status === "invoiced") throw new Error("الأمر مفوتر؛ احذف فاتورة المورد المسودة أولاً");
    await tx.update(s.purchaseOrders).set({ status, approvedBy: status === "approved" ? (userId ?? null) : null }).where(eq(s.purchaseOrders.id, id));
    // إلغاء الأمر يعيد طلبه معتمداً ليصدر له أمر آخر
    if (status === "cancelled" && po.requestId) await tx.update(s.purchaseRequests).set({ status: "approved" }).where(eq(s.purchaseRequests.id, po.requestId));
  });
}

export async function deleteOrder(db: Db, id: number) {
  return db.transaction(async (tx) => {
    const [po] = await tx.select().from(s.purchaseOrders).where(eq(s.purchaseOrders.id, id)).for("update");
    if (!po) return;
    if (po.status !== "draft" && po.status !== "cancelled") throw new Error("أرجع الأمر لمسودة أولاً");
    if (po.requestId && po.status === "draft") await tx.update(s.purchaseRequests).set({ status: "approved" }).where(eq(s.purchaseRequests.id, po.requestId));
    await tx.delete(s.purchaseOrders).where(eq(s.purchaseOrders.id, id));
  });
}

/** فاتورة مورد مسودة من أمر شراء معتمد؛ الأصناف المخزنية تدخل المستودع عند ترحيل الفاتورة. */
export async function orderToInvoice(db: Db, id: number, input: { supplierInvoiceNo: string; invoiceDate: string; warehouseId?: number | null; userId?: number }) {
  const [po] = await db.select().from(s.purchaseOrders).where(eq(s.purchaseOrders.id, id));
  if (!po) throw new Error("أمر الشراء غير موجود");
  if (po.status !== "approved") throw new Error("اعتمد أمر الشراء أولاً");
  const rows = await db.select({ l: s.purchaseOrderLines, p: s.products }).from(s.purchaseOrderLines).leftJoin(s.products, eq(s.products.id, s.purchaseOrderLines.productId)).where(eq(s.purchaseOrderLines.orderId, id)).orderBy(asc(s.purchaseOrderLines.lineNo));
  if (rows.some(({ p }) => p?.kind === "stock") && !input.warehouseId) throw new Error("اختر المستودع الذي تدخل إليه الأصناف");
  const inv = await createPurchaseInvoice(db, {
    supplierId: po.supplierId,
    supplierInvoiceNo: input.supplierInvoiceNo,
    invoiceDate: input.invoiceDate,
    currencyCode: po.currencyCode,
    notes: `من أمر الشراء ${po.number}`,
    userId: input.userId,
    lines: rows.map(({ l, p }) => ({
      productId: l.productId,
      accountId: l.accountId,
      warehouseId: p?.kind === "stock" ? input.warehouseId : null,
      quantity: Number(l.quantity),
      vehicleId: po.vehicleId,
      description: l.description,
      amount: round2(Number(l.quantity) * Number(l.unitPrice)),
      vatRate: Number(l.vatRate),
    })),
  });
  await db.update(s.purchaseOrders).set({ status: "invoiced", purchaseInvoiceId: inv.id }).where(eq(s.purchaseOrders.id, id));
  return inv;
}

export function orderTotals(lines: { quantity: string | number; unitPrice: string | number; vatRate: string | number }[]) {
  const subtotal = round2(lines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0));
  const vat = round2(lines.reduce((t, l) => t + (Number(l.quantity) * Number(l.unitPrice) * Number(l.vatRate)) / 100, 0));
  return { subtotal, vat, total: round2(subtotal + vat) };
}

export async function listRequests(db: Db) {
  return db
    .select({ r: s.purchaseRequests, plate: s.vehicles.plate, by: s.users.name })
    .from(s.purchaseRequests)
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.purchaseRequests.vehicleId))
    .leftJoin(s.users, eq(s.users.id, s.purchaseRequests.createdBy))
    .orderBy(desc(s.purchaseRequests.requestDate), desc(s.purchaseRequests.id))
    .limit(300);
}

export async function listOrders(db: Db) {
  return db
    .select({ o: s.purchaseOrders, supplier: s.parties.nameAr, request: s.purchaseRequests.number, invoice: s.purchaseInvoices.number, plate: s.vehicles.plate })
    .from(s.purchaseOrders)
    .innerJoin(s.parties, eq(s.parties.id, s.purchaseOrders.supplierId))
    .leftJoin(s.purchaseRequests, eq(s.purchaseRequests.id, s.purchaseOrders.requestId))
    .leftJoin(s.purchaseInvoices, eq(s.purchaseInvoices.id, s.purchaseOrders.purchaseInvoiceId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.purchaseOrders.vehicleId))
    .orderBy(desc(s.purchaseOrders.orderDate), desc(s.purchaseOrders.id))
    .limit(300);
}

export async function requestLines(db: Db, ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(s.purchaseRequestLines).where(inArray(s.purchaseRequestLines.requestId, ids)).orderBy(asc(s.purchaseRequestLines.lineNo));
}

export async function orderLines(db: Db, ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(s.purchaseOrderLines).where(inArray(s.purchaseOrderLines.orderId, ids)).orderBy(asc(s.purchaseOrderLines.lineNo));
}

export async function orderDoc(db: Db, id: number) {
  const [row] = await db
    .select({ o: s.purchaseOrders, supplier: s.parties, request: s.purchaseRequests.number, plate: s.vehicles.plate })
    .from(s.purchaseOrders)
    .innerJoin(s.parties, eq(s.parties.id, s.purchaseOrders.supplierId))
    .leftJoin(s.purchaseRequests, eq(s.purchaseRequests.id, s.purchaseOrders.requestId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.purchaseOrders.vehicleId))
    .where(and(eq(s.purchaseOrders.id, id)));
  if (!row) return null;
  const lines = await orderLines(db, [id]);
  return { ...row, lines, totals: orderTotals(lines) };
}
