"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { createPurchaseOrder, createPurchaseRequest, decideRequest, deleteOrder, deleteRequest, orderToInvoice, setOrderStatus } from "@/lib/purchasing";
import type { FormState } from "@/components/action-form";
import { redirect } from "next/navigation";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (v: unknown) => Number(String(v ?? "").replace(/[,\s]/g, "")) || 0;
const lines = (fd: FormData) => JSON.parse(str(fd, "lines") || "[]") as Record<string, string>[];

export async function saveRequest(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("purchase_invoices", "create");
  try {
    const pr = await createPurchaseRequest(db, {
      date: str(fd, "date"),
      neededBy: str(fd, "neededBy") || null,
      vehicleId: Number(str(fd, "vehicleId")) || null,
      notes: str(fd, "notes"),
      userId: user.id,
      lines: lines(fd).map((l) => ({ productId: Number(l.productId) || null, description: l.description ?? "", quantity: num(l.quantity), estimatedPrice: l.price ? num(l.price) : null })),
    });
    revalidatePath("/purchase-requests");
    return { ok: `حُفظ طلب الشراء ${pr.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function requestDecision(id: number, decision: "approve" | "reject" | "reopen", _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("purchase_invoices", decision === "reopen" ? "revert" : "approve");
  try {
    await decideRequest(db, id, decision, { reason: str(fd, "reason"), userId: user.id });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/purchase-requests");
  return { ok: decision === "approve" ? "اعتُمد الطلب" : decision === "reject" ? "رُفض الطلب" : "أُعيد لمسودة" };
}

export async function removeRequest(id: number, _: FormState): Promise<FormState> {
  await requirePermission("purchase_invoices", "delete");
  try {
    await deleteRequest(db, id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/purchase-requests");
  return { ok: "حُذف الطلب" };
}

export async function saveOrder(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("purchase_invoices", "create");
  let id: number;
  try {
    const po = await createPurchaseOrder(db, {
      date: str(fd, "date"),
      supplierId: Number(str(fd, "supplierId")),
      expectedDate: str(fd, "expectedDate") || null,
      requestId: Number(str(fd, "requestId")) || null,
      vehicleId: Number(str(fd, "vehicleId")) || null,
      currencyCode: str(fd, "currencyCode") || "SAR",
      notes: str(fd, "notes"),
      userId: user.id,
      lines: lines(fd).map((l) => ({ productId: Number(l.productId) || null, accountId: Number(l.accountId) || null, description: l.description ?? "", quantity: num(l.quantity), unitPrice: num(l.price), vatRate: num(l.vatRate) })),
    });
    id = po.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/purchase-orders");
  revalidatePath("/purchase-requests");
  redirect(`/purchase-orders/${id}`);
}

export async function orderStatus(id: number, status: "approved" | "draft" | "cancelled", _: FormState): Promise<FormState> {
  const user = await requirePermission("purchase_invoices", status === "approved" ? "approve" : "revert");
  try {
    await setOrderStatus(db, id, status, user.id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/purchase-requests");
  return { ok: status === "approved" ? "اعتُمد أمر الشراء" : status === "cancelled" ? "أُلغي أمر الشراء" : "أُعيد لمسودة" };
}

export async function invoiceOrder(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("purchase_invoices", "create");
  let invId: number;
  try {
    ({ id: invId } = await orderToInvoice(db, id, { supplierInvoiceNo: str(fd, "supplierInvoiceNo"), invoiceDate: str(fd, "invoiceDate"), warehouseId: Number(str(fd, "warehouseId")) || null, userId: user.id }));
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/purchase-orders");
  revalidatePath("/purchases");
  redirect(`/purchases?open=${invId}`);
}

export async function removeOrder(id: number, _: FormState): Promise<FormState> {
  await requirePermission("purchase_invoices", "delete");
  try {
    await deleteOrder(db, id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/purchase-orders");
  revalidatePath("/purchase-requests");
  redirect("/purchase-orders");
}
