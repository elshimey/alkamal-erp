"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import {
  createQuotation,
  deleteQuotation,
  duplicateQuotation,
  isShippingType,
  quotationToInvoice,
  setQuotationStatus,
  updateQuotation,
  updateQuotationFromSheet,
  QUOTE_STATUS,
  type QuoteInput,
  type QuoteSheetPatch,
  type QuoteStatus,
} from "@/lib/quotations";
import { cell } from "@/lib/sheet-server";
import type { FormState } from "@/components/action-form";
import type { DocSheetResult, SheetChange } from "@/components/doc-sheet";
import type { PanelResult } from "@/components/record-panel";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (v: unknown) => Number(String(v ?? "").replace(/[,\s]/g, "")) || 0;
const done = (id?: number) => {
  revalidatePath("/quotations");
  if (id) revalidatePath(`/quotations/${id}`);
};

function readForm(fd: FormData): Omit<QuoteInput, "userId"> {
  const lines = JSON.parse(str(fd, "lines") || "[]") as Record<string, string>[];
  const shipping = str(fd, "shippingType");
  return {
    date: str(fd, "date"),
    validUntil: str(fd, "validUntil"),
    customerId: Number(str(fd, "customerId")),
    currencyCode: str(fd, "currencyCode") || "SAR",
    shippingType: isShippingType(shipping) ? shipping : "international",
    reference: str(fd, "reference"),
    notes: str(fd, "notes"),
    terms: str(fd, "terms"),
    lines: lines.map((l) => ({
      routeId: Number(l.routeId) || null,
      description: l.description ?? "",
      quantity: num(l.quantity),
      unitPrice: num(l.price),
      vatRate: (l.vatRate ?? "") === "" ? null : num(l.vatRate),
    })),
  };
}

/** حفظ نافذة الإنشاء/التعديل. */
export async function saveQuotationPanel(id: number | null, fd: FormData): Promise<PanelResult> {
  const user = await requirePermission("sales_invoices", id ? "update" : "create");
  try {
    const input = readForm(fd);
    const q = id ? await updateQuotation(db, id, input) : await createQuotation(db, { ...input, userId: user.id });
    done(q.id);
    return { ok: id ? `حُفظ العرض ${q.number}` : `أُنشئ العرض ${q.number}`, id: q.id, label: q.number };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function quotationStatus(id: number, status: QuoteStatus): Promise<FormState> {
  await requirePermission("sales_invoices", "update");
  try {
    await setQuotationStatus(db, id, status);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  done(id);
  return { ok: `أصبحت حالة العرض: ${QUOTE_STATUS[status].label}` };
}

export async function convertQuotation(id: number, fd: FormData): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "create");
  let invoiceId: number;
  try {
    const inv = await quotationToInvoice(db, id, { invoiceDate: cell.date(str(fd, "invoiceDate"), "تاريخ الفاتورة") ?? todayRiyadh(), userId: user.id });
    invoiceId = inv.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  done(id);
  revalidatePath("/invoices");
  redirect(`/invoices?open=${invoiceId}`);
}

export async function copyQuotation(id: number, back: string): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "create");
  let newId: number;
  try {
    newId = (await duplicateQuotation(db, id, { date: todayRiyadh(), userId: user.id })).id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  done();
  redirect(`${back}${back.includes("?") ? "&" : "?"}edit=${newId}`);
}

export async function removeQuotation(id: number, back: string): Promise<FormState> {
  await requirePermission("sales_invoices", "delete");
  try {
    await deleteQuotation(db, id);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  done();
  redirect(back);
}

const idsOf = (fd: FormData) => [...new Set(fd.getAll("ids").map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/** تغيير حالة العروض المحددة من الجدول؛ كل عرض يُفحص وحده ويُذكر سبب ما رُفض. */
export async function bulkQuotations(_: FormState, fd: FormData): Promise<FormState> {
  const op = str(fd, "op");
  const ids = idsOf(fd);
  if (!ids.length) return { error: "حدد عرضاً واحداً على الأقل من الجدول" };
  if (op === "delete") await requirePermission("sales_invoices", "delete");
  else await requirePermission("sales_invoices", "update");
  if (op !== "delete" && !(op in QUOTE_STATUS)) return { error: "اختر العملية" };
  let ok = 0;
  const failed: string[] = [];
  for (const id of ids) {
    try {
      if (op === "delete") await deleteQuotation(db, id);
      else await setQuotationStatus(db, id, op as QuoteStatus);
      ok++;
    } catch (err) {
      failed.push(errorMessage(err));
    }
  }
  done();
  const what = op === "delete" ? "حُذف" : `أصبح «${QUOTE_STATUS[op as QuoteStatus].label}»`;
  if (!ok) return { error: failed.join("\n") };
  return failed.length ? { error: `${what} ${ok} عرض، ولم يُنفذ على ${failed.length}:\n${failed.join("\n")}` } : { ok: `${what} ${ok} عرض` };
}

/** حفظ الورقة: خلايا الرأس وخلايا البنود لكل عرض. */
export async function saveQuotationSheet(payload: string): Promise<DocSheetResult> {
  await requirePermission("sales_invoices", "update");
  const changes = JSON.parse(payload) as SheetChange[];
  const errors: Record<number, string> = {};
  let saved = 0;
  for (const { id, values: v, lines } of changes) {
    try {
      const shipping = v.shippingType;
      if (shipping !== undefined && !isShippingType(shipping)) throw new Error("نوع الشحن: دولي أو داخلي");
      const patch: QuoteSheetPatch = {
        header: {
          date: v.date !== undefined ? (cell.date(v.date, "التاريخ") ?? "") : undefined,
          validUntil: v.validUntil !== undefined ? (cell.date(v.validUntil, "صالح حتى") ?? "") : undefined,
          customerId: v.customerId !== undefined ? Number(v.customerId) || 0 : undefined,
          currencyCode: v.currency || undefined,
          shippingType: shipping,
          reference: v.reference,
          notes: v.notes,
          terms: v.terms,
        },
        lines: Object.fromEntries(
          Object.entries(lines ?? {}).map(([lineId, l]) => [
            Number(lineId),
            {
              ...(l.routeId !== undefined ? { routeId: Number(l.routeId) || null } : {}),
              ...(l.description !== undefined ? { description: l.description } : {}),
              ...(l.quantity !== undefined ? { quantity: cell.number(l.quantity, "الكمية") ?? 0 } : {}),
              ...(l.unitPrice !== undefined ? { unitPrice: cell.number(l.unitPrice, "السعر") ?? 0 } : {}),
              ...(l.vatRate !== undefined ? { vatRate: num(l.vatRate) } : {}),
            },
          ]),
        ),
      };
      await updateQuotationFromSheet(db, id, patch);
      saved++;
    } catch (err) {
      errors[id] = errorMessage(err);
    }
  }
  done();
  return { ok: saved ? `حُفظت تعديلات ${saved} عرض` : undefined, errors };
}
