"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { addWaybillsToInvoice, createAllInvoices, createInvoice, deleteInvoice, issueInvoice, removeInvoiceLine, revertInvoice, updateDraftInvoice, type DraftInvoicePatch } from "@/lib/invoices";
import type { SheetChange, DocSheetResult } from "@/components/doc-sheet";
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

/** إصدار مجموعة مسودات من الجدول؛ كل فاتورة بقيدها، وما فشل يُذكر سببه. */
export async function issueMany(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "approve");
  const ids = fd.getAll("ids").map(Number).filter(Number.isInteger);
  if (!ids.length) return { error: "حدد الفواتير المراد إصدارها" };
  const done: string[] = [];
  const errors: string[] = [];
  for (const id of ids) {
    try {
      done.push((await issueInvoice(db, id, user.id)).number);
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  refresh();
  return { ok: done.length ? `صدرت ${done.length} فاتورة ورُحّلت قيودها` : undefined, error: errors.length ? errors.join("\n") : undefined };
}

const SHEET_FIELDS = { invoiceDate: "invoiceDate", dueDate: "dueDate", notes: "notes" } as const;

/** حفظ تعديلات ورقة الفواتير: كل صف بقواعد المسودة نفسها، والأخطاء تعود لصفوفها. */
export async function saveInvoiceSheet(payload: string): Promise<DocSheetResult> {
  await requirePermission("sales_invoices", "update");
  const changes = JSON.parse(payload) as SheetChange[];
  const errors: Record<number, string> = {};
  let saved = 0;
  for (const { id, values } of changes) {
    const patch: DraftInvoicePatch = {};
    for (const [key, v] of Object.entries(values)) {
      const field = SHEET_FIELDS[key as keyof typeof SHEET_FIELDS];
      if (field) patch[field] = v;
    }
    try {
      await updateDraftInvoice(db, Number(id), patch);
      saved++;
    } catch (err) {
      errors[id] = errorMessage(err);
    }
  }
  refresh();
  return { ok: saved ? `حُفظت تعديلات ${saved} فاتورة` : undefined, errors };
}
