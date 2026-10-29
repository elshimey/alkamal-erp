"use server";

import { localPath } from "@/lib/safe-path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import {
  addWaybillsToInvoice,
  createAllInvoices,
  createDirectInvoice,
  createInvoice,
  deleteInvoice,
  issueInvoice,
  mergeInvoices,
  removeInvoiceLine,
  revertInvoice,
  unmergeInvoice,
  updateDirectInvoice,
  updateDraftInvoice,
  type DraftInvoicePatch,
  type ManualInvoiceInput,
} from "@/lib/invoices";
import { lineVat, round2 } from "@/lib/invoice-posting";
import type { PanelResult } from "@/components/record-panel";
import type { SheetChange, DocSheetResult } from "@/components/doc-sheet";
import type { FormState } from "@/components/action-form";
import { autoSubmit, submitDocument } from "@/lib/zatca/service";
import { bulkTrips, invoiceTripIds } from "@/lib/trip-dispatch";

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
  if (!created.length && !errors.length) return { error: "لا توجد شحنات معتمدة غير مفوترة حتى هذا التاريخ" };
  return {
    ok: created.length ? `أُنشئت ${created.length} فاتورة مسودة: ${created.map((c) => c.number).join("، ")}` : undefined,
    error: errors.length ? errors.join("\n") : undefined,
  };
}

export async function addWaybills(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("sales_invoices", "update");
  const ids = fd.getAll("waybillIds").map(Number).filter(Number.isInteger);
  if (!ids.length) return { error: "حدد شحنة واحدة على الأقل" };
  try {
    await addWaybillsToInvoice(db, id, ids);
    refresh(id);
    return { ok: `أُضيفت الشحنات: ${ids.length}` };
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
    const zatca = await autoSubmit(db, { invoiceId: id }, user.id);
    refresh(id);
    return { ok: `اعتُمدت الفاتورة برقم ${entry.invoiceNumber} ورُحّل القيد ${entry.number}${zatca ? ` ${zatca}` : ""}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revert(id: number): Promise<FormState> {
  await requirePermission("sales_invoices", "revert");
  try {
    await revertInvoice(db, id);
    refresh(id);
    return { ok: "أُرجعت الفاتورة لمسودة وأُلغي قيدها، وتحتفظ برقمها الرسمي" };
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
      await issueInvoice(db, id, user.id);
      const [{ number }] = await db.select({ number: s.salesInvoices.number }).from(s.salesInvoices).where(eq(s.salesInvoices.id, id));
      done.push(number);
      const zatca = await autoSubmit(db, { invoiceId: id }, user.id);
      if (zatca && !zatca.startsWith("واعتمد")) errors.push(`${number}: صدرت ${zatca}`);
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  refresh();
  return { ok: done.length ? `صدرت ${done.length} فاتورة ورُحّلت قيودها` : undefined, error: errors.length ? errors.join("\n") : undefined };
}

/** إرسال الفاتورة (أو إعادة إرسالها) لبوابة فاتورة للاعتماد. */
export async function sendToZatca(id: number): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "approve");
  try {
    const row = await submitDocument(db, { invoiceId: id }, user.id);
    refresh(id);
    if (row.status === "cleared") return { ok: "اعتمدت الهيئة الفاتورة" };
    if (row.status === "cleared_warnings") return { ok: `اعتمدت الهيئة الفاتورة بملاحظات: ${row.warnings.join(" · ")}` };
    return { error: `لم تعتمد الهيئة الفاتورة: ${(row.errors as string[]).join(" · ")}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
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

/** فك الدمج: كل شحنة أو فاتورة مدمجة تصبح فاتورة مسودة مستقلة، وتبقى هذه بأول جزء. */
export async function unmerge(id: number): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "update");
  try {
    const r = await unmergeInvoice(db, id, user.id);
    refresh(id);
    return { ok: `فُك دمج ${r.number}: أُنشئت ${r.created.length} فاتورة مسودة مستقلة (${r.created.join("، ")})` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** إرجاع فاتورة مصدرة لمسودة من قائمة العمليات (ممنوع إذا عليها دفعة سداد). */
export async function revertFromMenu(id: number): Promise<FormState> {
  return revert(id);
}

/** حذف المسودة من قائمة العمليات بعد التأكيد وسبب الحذف. */
export async function removeFromMenu(id: number, back: string, fd: FormData): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "delete");
  try {
    await deleteInvoice(db, id, { reason: String(fd.get("reason") ?? ""), userId: user.id });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect(localPath(back, "/invoices"));
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const toNum = (v: unknown) => Number(String(v ?? "").replace(/[,\s]/g, "")) || 0;

function requiredId(fd: FormData, key: string, message: string) {
  const v = Number(str(fd, key));
  if (!v) throw new Error(message);
  return v;
}

/** رحلة السائق في الفاتورة المباشرة: «1» = برحلة، «0» = بلا رحلة، غير موجودة = بلا تغيير. */
function readTrip(fd: FormData): ManualInvoiceInput["trip"] {
  const on = str(fd, "tripOn");
  if (on !== "1") return on === "0" ? null : undefined;
  const custody = toNum(str(fd, "tripCustody"));
  if (custody < 0) throw new Error("عهدة الرحلة لا تكون سالبة");
  return {
    routeId: requiredId(fd, "tripRouteId", "رحلة السائق: اختر المسار"),
    vehicleId: requiredId(fd, "tripVehicleId", "رحلة السائق: اختر المركبة"),
    driverId: Number(str(fd, "tripDriverId")) || null,
    shipper: str(fd, "tripShipper"),
    consignee: str(fd, "tripConsignee"),
    tripCustody: custody,
  };
}

async function readInvoiceForm(fd: FormData): Promise<ManualInvoiceInput> {
  const rows = (JSON.parse(str(fd, "lines") || "[]") as Record<string, string>[]).filter((l) => (l.description ?? "").trim() || toNum(l.price));
  const taxes = await db.select({ id: s.taxCodes.id, code: s.taxCodes.code }).from(s.taxCodes).where(inArray(s.taxCodes.code, ["VAT15-OUT", "ZERO"]));
  const [domestic] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, "4101"));
  return {
    customerId: Number(str(fd, "customerId")) || 0,
    invoiceDate: str(fd, "invoiceDate"),
    dueDate: str(fd, "dueDate"),
    currencyCode: str(fd, "currencyCode") || "SAR",
    reference: str(fd, "reference") || null,
    notes: str(fd, "notes") || null,
    trip: readTrip(fd),
    lines: rows.map((l, i) => {
      const description = (l.description ?? "").trim();
      if (!description) throw new Error(`البند ${i + 1}: اكتب الوصف`);
      const quantity = l.quantity === "" || l.quantity == null ? 1 : toNum(l.quantity);
      const unitPrice = toNum(l.price);
      if (!(quantity > 0)) throw new Error(`البند ${i + 1}: الكمية يجب أن تكون أكبر من صفر`);
      if (!(unitPrice > 0)) throw new Error(`البند ${i + 1}: اكتب السعر`);
      const discountPercent = Math.min(100, Math.max(0, toNum(l.discount)));
      const amount = round2(quantity * unitPrice * (1 - discountPercent / 100));
      const vatRate = l.vatRate === "0" ? 0 : 15;
      return {
        description,
        quantity,
        unitPrice,
        discountPercent,
        amount,
        vatRate,
        vatAmount: lineVat(amount, vatRate),
        taxCodeId: taxes.find((t) => t.code === (vatRate ? "VAT15-OUT" : "ZERO"))?.id ?? null,
        accountId: Number(l.accountId) || domestic.id,
        costCenterId: Number(l.costCenterId) || null,
      };
    }),
  };
}

/** حفظ نافذة إنشاء الفاتورة المباشرة أو تعديل مسودة. */
export async function saveInvoicePanel(id: number | null, fd: FormData): Promise<PanelResult> {
  const user = await requirePermission("sales_invoices", id ? "update" : "create");
  try {
    const input = await readInvoiceForm(fd);
    const inv = id ? await updateDirectInvoice(db, id, input) : await createDirectInvoice(db, { ...input, userId: user.id });
    refresh(inv.id);
    return { ok: id ? `حُفظت الفاتورة ${inv.number}` : `أُنشئت الفاتورة ${inv.number} مسودة؛ اعتمدها لتصدر برقمها الرسمي`, id: inv.id, label: inv.number };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** العمليات على الفواتير المحددة: الاعتماد، والإرجاع لمسودة، والدمج، وفك الدمج، والحذف. */
export async function bulkInvoiceOps(_: FormState, fd: FormData): Promise<FormState> {
  const op = str(fd, "op");
  const ids = [...new Set(fd.getAll("ids").map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (!ids.length) return { error: "حدد فاتورة واحدة على الأقل من الجدول" };
  if (op === "issue") return issueMany(undefined, fd);
  if (op === "send_driver" || op === "unsend_driver") return dispatchInvoices(ids, op === "send_driver" ? "send" : "unsend", fd);
  if (op === "merge") {
    const user = await requirePermission("sales_invoices", "update");
    try {
      const r = await mergeInvoices(db, ids, user.id);
      refresh(r.id);
      return { ok: `دُمجت ${r.merged.length + 1} فواتير في ${r.number}` };
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }
  const perm = op === "revert" ? "revert" : op === "delete" ? "delete" : "update";
  if (!["revert", "unmerge", "delete"].includes(op)) return { error: "اختر العملية" };
  const user = await requirePermission("sales_invoices", perm);
  const done: string[] = [];
  const errors: string[] = [];
  const rows = await db.select({ id: s.salesInvoices.id, number: s.salesInvoices.number }).from(s.salesInvoices).where(inArray(s.salesInvoices.id, ids));
  for (const r of rows) {
    try {
      if (op === "revert") await revertInvoice(db, r.id);
      else if (op === "unmerge") await unmergeInvoice(db, r.id, user.id);
      else await deleteInvoice(db, r.id, { reason: str(fd, "reason") || "حذف من قائمة الفواتير", userId: user.id });
      done.push(r.number);
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  refresh();
  const verb = { revert: "أُرجعت لمسودة", unmerge: "فُك دمج", delete: "حُذفت" }[op as "revert" | "unmerge" | "delete"];
  const msg = done.length ? `${verb} ${done.length} فاتورة: ${done.join("، ")}` : "";
  if (!done.length) return { error: errors.join("\n") };
  return errors.length ? { error: `${msg}\nولم يُنفذ:\n${errors.join("\n")}` } : { ok: msg };
}

/** إرسال رحلات الفواتير للسائقين أو إلغاء إرسالها (رحلة الفاتورة المباشرة والشحنات التي فيها). */
async function dispatchInvoices(invoiceIds: number[], op: "send" | "unsend", fd?: FormData): Promise<FormState> {
  const user = await requirePermission("waybills", "update");
  const trips = await invoiceTripIds(db, invoiceIds);
  if (!trips.length) return { error: "لا توجد رحلة سائق في الفواتير المحددة؛ أضف «رحلة السائق» من تعديل الفاتورة المباشرة أولاً" };
  const res = await bulkTrips(db, trips, op, { cashAccountId: fd ? Number(str(fd, "cashAccountId")) || null : null, userId: user.id });
  refresh();
  const what = op === "send" ? `أُرسلت ${res.done.length} رحلة للسائق (${res.done.join("، ")})` : `أُلغي إرسال ${res.done.length} رحلة وسُحبت من تطبيق السائق`;
  if (!res.done.length) return { error: res.skipped.join("\n") };
  return res.skipped.length ? { error: `${what}، ولم يُنفذ:\n${res.skipped.join("\n")}` } : { ok: what };
}

export async function sendInvoiceToDriver(id: number, fd: FormData): Promise<FormState> {
  return dispatchInvoices([id], "send", fd);
}

export async function unsendInvoiceFromDriver(id: number): Promise<FormState> {
  return dispatchInvoices([id], "unsend");
}
