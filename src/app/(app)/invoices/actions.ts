"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { addWaybillsToInvoice, createAllInvoices, createInvoice, deleteInvoice, issueInvoice, removeInvoiceLine, revertInvoice } from "@/lib/invoices";
import type { FormState } from "@/components/action-form";

const refresh = (id?: number) => {
  revalidatePath("/invoices");
  revalidatePath("/waybills");
  revalidatePath("/");
  if (id) revalidatePath(`/invoices/${id}`);
};

const dateOf = (fd: FormData) => String(fd.get("invoiceDate") || todayRiyadh());

export async function invoiceCustomer(customerId: number, currencyCode: string, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "create");
  let id: number;
  try {
    id = (await createInvoice(db, { customerId, currencyCode, invoiceDate: dateOf(fd), userId: user.id })).id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect(`/invoices/${id}`);
}

export async function invoiceAll(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "create");
  const { created, errors } = await createAllInvoices(db, dateOf(fd), user.id);
  refresh();
  if (!created.length && !errors.length) return { error: "لا توجد بوالص معتمدة غير مفوترة حتى هذا التاريخ" };
  return {
    ok: created.length ? `أُنشئت ${created.length} فاتورة مسودة: ${created.map((c) => c.number).join("، ")}` : undefined,
    error: errors.length ? errors.join("\n") : undefined,
  };
}

export async function addWaybills(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("sales_invoices", "update");
  const ids = fd.getAll("waybillIds").map(Number).filter(Number.isInteger);
  if (!ids.length) return { error: "حدد بوليصة واحدة على الأقل" };
  try {
    await addWaybillsToInvoice(db, id, ids);
    refresh(id);
    return { ok: `أُضيفت البوالص: ${ids.length}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function removeLine(id: number, lineId: number) {
  await requirePermission("sales_invoices", "update");
  await removeInvoiceLine(db, id, lineId);
  refresh(id);
}

export async function issue(id: number): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "approve");
  try {
    const entry = await issueInvoice(db, id, user.id);
    refresh(id);
    return { ok: `صدرت الفاتورة ورُحّل القيد ${entry.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revert(id: number): Promise<FormState> {
  await requirePermission("sales_invoices", "revert");
  try {
    await revertInvoice(db, id);
    refresh(id);
    return { ok: "أُرجعت الفاتورة لمسودة وأُلغي قيدها" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function remove(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "delete");
  try {
    await deleteInvoice(db, id, { reason: String(fd.get("reason") ?? ""), userId: user.id });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect("/invoices");
}
