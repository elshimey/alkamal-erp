"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { cell, type SheetRow } from "@/lib/sheet-server";
import type { SheetResult } from "@/lib/sheet";
import { createPurchaseInvoice, deletePurchaseInvoice, postPurchaseInvoice, revertPurchaseInvoice, updateDraftPurchase, type DraftPurchasePatch, type PurchaseLineInput } from "@/lib/purchases";
import type { DocSheetResult, SheetChange } from "@/components/doc-sheet";
import type { FormState } from "@/components/action-form";

const refresh = (id?: number) => {
  revalidatePath("/purchases");
  revalidatePath("/payments");
  revalidatePath("/");
  if (id) revalidatePath(`/purchases/${id}`);
};

/** كل صف سطر؛ الصفوف التي لها نفس المورد ورقم فاتورته تُجمع في فاتورة واحدة. */
export async function savePurchases(rows: SheetRow[]): Promise<SheetResult> {
  const user = await requirePermission("purchase_invoices", "create");
  if (!Array.isArray(rows) || rows.length > 2000) return { saved: 0, error: "عدد الصفوف أكبر من المسموح (2000)" };
  const post = can(user.perms, "purchase_invoices", "approve");
  const rowErrors: Record<number, string> = {};
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const key = `${(r.supplierId ?? "").trim()}|${(r.supplierInvoiceNo ?? "").trim()}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  let saved = 0;
  for (const idx of groups.values()) {
    const first = rows[idx[0]];
    try {
      const lines: PurchaseLineInput[] = idx.map((i, k) => {
        const r = rows[i];
        const amount = cell.number(r.amount, `السطر ${k + 1}: المبلغ`);
        if (!amount) throw new Error(`السطر ${k + 1}: المبلغ إلزامي`);
        return {
          accountId: Number(cell.required(r.accountId, "الحساب")),
          vehicleId: r.vehicleId ? Number(r.vehicleId) : null,
          description: cell.text(r.description) ?? "",
          amount,
          vatRate: r.vat === "0" ? 0 : 15,
        };
      });
      await createPurchaseInvoice(db, {
        supplierId: Number(cell.required(first.supplierId, "المورد")),
        supplierInvoiceNo: cell.required(first.supplierInvoiceNo, "رقم فاتورة المورد"),
        invoiceDate: cell.date(first.date, "التاريخ") ?? cell.required("", "التاريخ"),
        dueDate: cell.date(first.dueDate, "الاستحقاق"),
        currencyCode: first.currency === "KWD" ? "KWD" : "SAR",
        exchangeRate: cell.number(first.rate, "سعر الصرف"),
        lines,
        post,
        userId: user.id,
      });
      saved += idx.length;
    } catch (err) {
      for (const i of idx) rowErrors[i] = errorMessage(err);
    }
  }
  refresh();
  return { saved, rowErrors: Object.keys(rowErrors).length ? rowErrors : undefined };
}

export async function post(id: number): Promise<FormState> {
  const user = await requirePermission("purchase_invoices", "approve");
  try {
    const entry = await postPurchaseInvoice(db, id, user.id);
    refresh(id);
    return { ok: `رُحّل القيد ${entry.number}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revert(id: number): Promise<FormState> {
  await requirePermission("purchase_invoices", "revert");
  try {
    await revertPurchaseInvoice(db, id);
    refresh(id);
    return { ok: "أُرجعت الفاتورة لمسودة" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function remove(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("purchase_invoices", "delete");
  try {
    await deletePurchaseInvoice(db, id, { reason: String(fd.get("reason") || ""), userId: user.id });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect("/purchases");
}

/** ترحيل مجموعة مسودات من الجدول؛ كل فاتورة بقيدها، وما فشل يُذكر سببه. */
export async function postMany(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("purchase_invoices", "approve");
  const ids = fd.getAll("ids").map(Number).filter(Number.isInteger);
  if (!ids.length) return { error: "حدد الفواتير المراد ترحيلها" };
  let done = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try {
      await postPurchaseInvoice(db, id, user.id);
      done++;
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  refresh();
  return { ok: done ? `رُحّلت ${done} فاتورة` : undefined, error: errors.length ? errors.join("\n") : undefined };
}

const SHEET_FIELDS = { supplierInvoiceNo: "supplierInvoiceNo", invoiceDate: "invoiceDate", dueDate: "dueDate", notes: "notes" } as const;

/** حفظ تعديلات ورقة فواتير الموردين بقواعد المسودة نفسها. */
export async function savePurchaseSheet(payload: string): Promise<DocSheetResult> {
  await requirePermission("purchase_invoices", "update");
  const changes = JSON.parse(payload) as SheetChange[];
  const errors: Record<number, string> = {};
  let saved = 0;
  for (const { id, values } of changes) {
    const patch: DraftPurchasePatch = {};
    for (const [key, v] of Object.entries(values)) {
      const field = SHEET_FIELDS[key as keyof typeof SHEET_FIELDS];
      if (field) patch[field] = v;
    }
    try {
      await updateDraftPurchase(db, Number(id), patch);
      saved++;
    } catch (err) {
      errors[id] = errorMessage(err);
    }
  }
  refresh();
  return { ok: saved ? `حُفظت تعديلات ${saved} فاتورة` : undefined, errors };
}
