"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { createQuotation, deleteQuotation, quotationToInvoice, setQuotationStatus } from "@/lib/quotations";
import type { FormState } from "@/components/action-form";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (v: unknown) => Number(String(v ?? "").replace(/[,\s]/g, "")) || 0;

export async function saveQuotation(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "create");
  let id: number;
  try {
    const lines = JSON.parse(str(fd, "lines") || "[]") as Record<string, string>[];
    const q = await createQuotation(db, {
      date: str(fd, "date"),
      validUntil: str(fd, "validUntil"),
      customerId: Number(str(fd, "customerId")),
      currencyCode: str(fd, "currencyCode") || "SAR",
      notes: str(fd, "notes"),
      terms: str(fd, "terms"),
      userId: user.id,
      lines: lines.map((l) => ({ routeId: Number(l.routeId) || null, description: l.description ?? "", quantity: num(l.quantity), unitPrice: num(l.price), vatRate: num(l.vatRate) })),
    });
    id = q.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/quotations");
  redirect(`/quotations/${id}`);
}

export async function quotationStatus(id: number, status: "draft" | "sent" | "accepted" | "rejected", _: FormState): Promise<FormState> {
  await requirePermission("sales_invoices", "update");
  try {
    await setQuotationStatus(db, id, status);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  return { ok: "حُدّثت حالة العرض" };
}

export async function convertQuotation(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "create");
  let invoiceId: number;
  try {
    const inv = await quotationToInvoice(db, id, { invoiceDate: str(fd, "invoiceDate"), userId: user.id });
    invoiceId = inv.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/quotations");
  revalidatePath("/invoices");
  redirect(`/invoices/${invoiceId}`);
}

export async function removeQuotation(id: number, _: FormState): Promise<FormState> {
  await requirePermission("sales_invoices", "delete");
  try {
    await deleteQuotation(db, id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/quotations");
  redirect("/quotations");
}
