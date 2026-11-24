"use server";

import { localPath } from "@/lib/safe-path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import {
  addInvoiceChargesTx,
  addWaybillsToInvoice,
  createAllInvoices,
  createDirectInvoice,
  createDirectInvoiceTx,
  createInvoice,
  currentTrip,
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
import { taxCodesFor } from "@/lib/tax-codes";
import { addCustomerCharges, parseChargeRows, readIds } from "@/lib/customer-charges";
import { billTripExpensesToCustomer } from "@/lib/purchases";
import type { PanelResult } from "@/components/record-panel";
import type { SheetChange, DocSheetResult } from "@/components/doc-sheet";
import type { FormState } from "@/components/action-form";
import { autoSubmit, submitDocument } from "@/lib/zatca/service";
import { bulkTrips, invoiceTripIds, sendTrip } from "@/lib/trip-dispatch";
import { splitCustom } from "@/data/custom-lists";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";

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
  const picked = fd.getAll("ids").map(Number).filter(Number.isInteger);
  if (!picked.length) return { error: "حدد الفواتير المراد إصدارها" };
  // الترقيم الرسمي يتبع تاريخ الفاتورة ثم رقم المسودة، أياً كان ترتيب العرض (ملاحظة التشغيل 14)
  const ids = (
    await db
      .select({ id: s.salesInvoices.id })
      .from(s.salesInvoices)
      .where(inArray(s.salesInvoices.id, picked))
      .orderBy(asc(s.salesInvoices.invoiceDate), asc(s.salesInvoices.id))
  ).map((r) => r.id);
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
  const carrier = str(fd, "tripExecution") === "carrier";
  const base = {
    routeId: requiredId(fd, "tripRouteId", "اختر المسار"),
    vehicleId: carrier ? null : requiredId(fd, "tripVehicleId", "اختر المركبة أو الناقل الخارجي"),
    driverId: carrier ? null : Number(str(fd, "tripDriverId")) || null,
    shipper: str(fd, "tripShipper"),
    consignee: str(fd, "tripConsignee"),
    tripCustody: carrier ? 0 : custody,
  };
  // الطريقة القديمة (رحلة سعرها من بنود الفاتورة) تبقى لمسودات حُفظت بها
  if (str(fd, "tripPriced") !== "1") return base;
  const opt = (k: string) => (str(fd, k) === "" ? null : toNum(str(fd, k)));
  const components = (JSON.parse(str(fd, "tripComponents") || "[]") as { kind: string; label?: string; quantity: string; unitPrice: string }[])
    .filter((c) => c.kind || toNum(c.unitPrice))
    .map((c) => {
      const { base, classId } = splitCustom(c.kind);
      return { kind: base ?? "", classId, label: c.label || null, quantity: c.quantity === "" ? 1 : toNum(c.quantity), unitPrice: toNum(c.unitPrice) };
    });
  return {
    ...base,
    priced: true,
    trailerId: carrier ? null : Number(str(fd, "tripTrailerId")) || null,
    driverCommission: carrier ? null : opt("tripCommission"),
    carrierId: carrier ? requiredId(fd, "tripCarrierId", "اختر الناقل الخارجي") : null,
    carrierCost: carrier ? toNum(str(fd, "tripCarrierCost")) : null,
    carrierPlate: carrier ? str(fd, "tripCarrierPlate") || null : null,
    carrierDriverName: carrier ? str(fd, "tripCarrierDriver") || null : null,
    amount: opt("tripAmount"),
    priceComponents: components,
    taxCodeId: Number(str(fd, "tripTaxCodeId")) || null,
    weightTons: opt("tripWeight"),
    containerNumber: str(fd, "tripContainer") || null,
    deliveryNoteNumber: str(fd, "tripDeliveryNote") || null,
    customsDeclaration: str(fd, "tripCustoms") || null,
  };
}

async function readInvoiceForm(fd: FormData): Promise<ManualInvoiceInput> {
  const rows = (JSON.parse(str(fd, "lines") || "[]") as Record<string, string>[]).filter((l) => (l.description ?? "").trim() || toNum(l.price));
  const taxes = await taxCodesFor(db, "sales");
  const [domestic] = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, "4101"));
  const fixed = (JSON.parse(str(fd, "fixedLines") || "[]") as { id: number; amount: string; description: string }[]).map((f) => ({
    lineId: Number(f.id),
    amount: toNum(f.amount),
    description: String(f.description ?? "").trim(),
  }));
  return {
    customerId: Number(str(fd, "customerId")) || 0,
    invoiceDate: str(fd, "invoiceDate"),
    dueDate: str(fd, "dueDate"),
    currencyCode: str(fd, "currencyCode") || "SAR",
    reference: str(fd, "reference") || null,
    notes: str(fd, "notes") || null,
    trip: readTrip(fd),
    fixedEdits: fixed.length ? fixed : undefined,
    lines: rows.map((l, i) => {
      const description = (l.description ?? "").trim();
      if (!description) throw new Error(`البند ${i + 1}: اكتب الوصف`);
      const quantity = l.quantity === "" || l.quantity == null ? 1 : toNum(l.quantity);
      const unitPrice = toNum(l.price);
      if (!(quantity > 0)) throw new Error(`البند ${i + 1}: الكمية يجب أن تكون أكبر من صفر`);
      if (!(unitPrice > 0)) throw new Error(`البند ${i + 1}: اكتب السعر`);
      const discountPercent = Math.min(100, Math.max(0, toNum(l.discount)));
      const amount = round2(quantity * unitPrice * (1 - discountPercent / 100));
      const tax = taxes.find((t) => String(t.id) === String(l.taxCodeId ?? "")) ?? taxes.find((t) => t.code === "VAT15-OUT");
      if (!tax) throw new Error(`البند ${i + 1}: اختر نوع الضريبة`);
      const vatRate = Number(tax.rate);
      return {
        description,
        quantity,
        unitPrice,
        discountPercent,
        amount,
        vatRate,
        vatAmount: lineVat(amount, vatRate),
        taxCodeId: tax.id,
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
    // مصاريف على العميل: تُفحص قبل الحفظ، وتُحفظ مع الفاتورة كلها أو لا شيء. في الفاتورة المباشرة (بلا شحنات)
    // يكون المصروف على الفاتورة نفسها، وإيصالات سائق رحلتها تُحمَّل برقمها
    const own = id
      ? (await db.selectDistinct({ w: s.salesInvoiceLines.waybillId }).from(s.salesInvoiceLines).where(and(eq(s.salesInvoiceLines.invoiceId, id), eq(s.salesInvoiceLines.kind, "waybill")))).flatMap((o) => (o.w ? [o.w] : []))
      : [];
    const charges = parseChargeRows(str(fd, "newCharges"), undefined, { invoiceLevel: !own.length });
    const billIds = id ? readIds(str(fd, "billExpenses")) : [];
    if (charges.some((c) => c.waybillId && !own.includes(c.waybillId))) throw new Error("المصروف لشحنة ليست في هذه الفاتورة");
    if (charges.length || billIds.length) await requirePermission("waybills", "update");
    const trip = id ? await currentTrip(db, id) : null;
    // «على الشركة» تكلفة رحلة لا سطر فاتورة: دون شحنة تُحمَّل على رحلة الفاتورة المباشرة نفسها
    const onInvoice = charges.filter((c) => !c.waybillId && c.charge.billTo !== "company");
    const companyLoose = charges.filter((c) => !c.waybillId && c.charge.billTo === "company");
    input.hasCharges = onInvoice.length > 0 || billIds.length > 0;
    const inv = await db.transaction(async (tx) => {
      const saved = id ? await updateDirectInvoice(tx as unknown as typeof db, id, input) : await createDirectInvoice(tx as unknown as typeof db, { ...input, userId: user.id });
      if (billIds.length) await billTripExpensesToCustomer(tx, billIds, [...own, ...(trip ? [trip.id] : [])], user.id);
      let loose = companyLoose;
      if (loose.length) {
        const t = await currentTrip(tx, saved.id);
        if (!t) throw new Error("المصروف «على الشركة» تكلفة رحلة: اختر المسار في قسم النقل، أو اجعله «على العميل»");
        loose = loose.map((c) => ({ ...c, waybillId: t.id }));
      }
      await addCustomerCharges(tx, [...charges.filter((c) => c.waybillId), ...loose], user.id);
      await addInvoiceChargesTx(tx, saved.id, onInvoice.map((c) => c.charge), user.id);
      return saved;
    });
    if (charges.length || billIds.length) {
      revalidatePath("/expenses");
      revalidatePath("/waybills");
      revalidatePath("/reports/unbilled-charges");
    }
    refresh(inv.id);
    const done = [id ? `حُفظت الفاتورة ${inv.number}` : `أُنشئت الفاتورة ${inv.number} مسودة`];
    // بعد الحفظ: الإرسال للسائق على مرحلة التسليم، ثم الإصدار (كل خطوة تُذكر نتيجتها ولا تلغي الحفظ)
    const after = await afterSave(inv.id, fd, user.id);
    done.push(...after.ok);
    if (!after.ok.length && !after.error && !id) done[0] += "؛ أصدرها لتأخذ رقمها الرسمي";
    return after.error ? { error: `${done.join("، ")}، لكن: ${after.error}`, id: inv.id, label: inv.number } : { ok: done.join("، "), id: inv.id, label: inv.number };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** «أرسلها للسائق على مرحلة التسليم» و«حفظ وإصدار» من نافذة الفاتورة المباشرة. */
async function afterSave(id: number, fd: FormData, userId: number): Promise<{ ok: string[]; error?: string }> {
  const ok: string[] = [];
  try {
    if (str(fd, "sendDriver") === "1") {
      await requirePermission("waybills", "update");
      const trip = await currentTrip(db, id);
      if (!trip) throw new Error("لا توجد رحلة للإرسال؛ اختر المسار والمركبة");
      if (!trip.sentToDriverAt) {
        const defer = str(fd, "cashAccountId") === "defer";
        const r = await sendTrip(db, trip.id, { atDelivery: true, cashAccountId: defer ? null : Number(str(fd, "cashAccountId")) || null, deferCustody: defer, userId });
        ok.push(`وأُرسلت للسائق ${r.driver ?? ""} على مرحلة التسليم`.replace("  ", " "));
      }
    }
    if (fd.get("issueNow") != null) {
      await requirePermission("sales_invoices", "approve");
      const entry = await issueInvoice(db, id, userId);
      const zatca = await autoSubmit(db, { invoiceId: id }, userId);
      ok.push(`وصدرت برقم ${entry.invoiceNumber}${zatca ? ` ${zatca}` : ""}`);
    }
    refresh(id);
    return { ok };
  } catch (err) {
    refresh(id);
    return { ok, error: errorMessage(err) };
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
  return errors.length ? { ok: msg, error: `ولم يُنفذ:\n${errors.join("\n")}` } : { ok: msg };
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
  return res.skipped.length ? { ok: what, error: `ولم يُنفذ:\n${res.skipped.join("\n")}` } : { ok: what };
}

export async function sendInvoiceToDriver(id: number, fd: FormData): Promise<FormState> {
  return dispatchInvoices([id], "send", fd);
}

export async function unsendInvoiceFromDriver(id: number): Promise<FormState> {
  return dispatchInvoices([id], "unsend");
}

const optId = (v: string | undefined) => (v && v.trim() ? Number(v) : null);

/**
 * إدخال عدة فواتير مباشرة من الشيت: كل صف فاتورة مسودة بنقلها (المسار والتنفيذ والسعر ومكوناته) ومصاريف العميل،
 * بنفس قواعد نافذة الفاتورة، والصف الخاطئ وحده يُرفض بسببه. «إرسال للسائق» يرسلها على مرحلة التسليم.
 */
export async function saveInvoiceRows(rows: SheetRow[]) {
  const user = await requirePermission("sales_invoices", "create");
  const sends: number[] = [];
  const result = await saveSheetRows(rows, async (r) => {
    const date = cell.date(r.date, "التاريخ") ?? todayRiyadh();
    const due = cell.date(r.dueDate, "الاستحقاق") ?? date;
    const carrierId = optId(r.carrierId);
    const components = [1, 2].flatMap((n) => {
      const kind = cell.text(r[`comp${n}`]);
      if (!kind) return [];
      const unitPrice = cell.number(r[`comp${n}Price`], `سعر المكون ${n}`);
      if (!unitPrice) throw new Error(`سعر المكون ${n} إلزامي`);
      const { base, classId } = splitCustom(kind);
      return [{ kind: base!, classId, quantity: cell.number(r[`comp${n}Qty`], `كمية المكون ${n}`) ?? 1, unitPrice }];
    });
    const charges = [1, 2].flatMap((n) => {
      const type = cell.text(r[`charge${n}`]);
      const amount = cell.number(r[`charge${n}Amount`], `مبلغ المصروف ${n}`);
      const from = cell.text(r[`charge${n}From`]);
      if (!type && !amount && !from) return [];
      if (!type) throw new Error(`اختر نوع المصروف على العميل ${n}`);
      if (!amount) throw new Error(`مبلغ المصروف ${n} إلزامي`);
      const m = from?.match(/^([ab]):(\d+)$/);
      if (!m) throw new Error(`اختر من دفع المصروف ${n}: حساب الشركة أو المخلص`);
      return [m[1] === "b" ? { chargeTypeId: Number(type), amount, payer: "customs_broker" as const, partyId: Number(m[2]), billTo: "customer" as const } : { chargeTypeId: Number(type), amount, payer: "cash" as const, cashAccountId: Number(m[2]), billTo: "customer" as const }];
    });
    const send = ["1", "نعم", "yes", "true"].includes(String(r.send ?? "").trim().toLowerCase());
    if (send && carrierId) throw new Error("الناقل الخارجي لا يُرسل لسائق في التطبيق");
    const id = await db.transaction(async (tx) => {
      const inv = await createDirectInvoiceTx(tx, {
        customerId: Number(cell.required(r.customerId, "العميل")),
        invoiceDate: date,
        dueDate: due,
        currencyCode: "SAR",
        reference: cell.text(r.reference),
        notes: cell.text(r.notes),
        userId: user.id,
        lines: [],
        hasCharges: charges.length > 0,
        trip: {
          priced: true,
          routeId: Number(cell.required(r.routeId, "المسار")),
          vehicleId: carrierId ? null : optId(r.vehicleId),
          driverId: carrierId ? null : optId(r.driverId),
          carrierId,
          carrierCost: cell.number(r.carrierCost, "تكلفة الناقل"),
          carrierPlate: cell.text(r.carrierPlate),
          shipper: cell.required(r.shipper, "المرسل"),
          consignee: cell.required(r.consignee, "المستلم"),
          amount: cell.number(r.amount, "السعر الأساسي"),
          priceComponents: components,
          taxCodeId: optId(r.taxCodeId),
          driverCommission: cell.number(r.commission, "عمولة السائق"),
          containerNumber: cell.text(r.container),
          weightTons: cell.number(r.weight, "الوزن"),
        },
      });
      if (charges.length) await addInvoiceChargesTx(tx, inv.id, charges, user.id);
      return inv.id;
    });
    if (send) sends.push(id);
  });
  // الإرسال بعد الحفظ (بلا عهدة رحلة في الشيت)؛ ما لا يُرسل يُذكر ولا يلغي الفاتورة
  const failed: string[] = [];
  for (const id of sends) {
    try {
      const trip = await currentTrip(db, id);
      if (trip) await sendTrip(db, trip.id, { atDelivery: true, userId: user.id });
    } catch (err) {
      failed.push(errorMessage(err));
    }
  }
  refresh();
  if (failed.length) return { ...result, error: [result.error, `حُفظت الفواتير، ولم يُرسل للسائق: ${failed.join("، ")}`].filter(Boolean).join("\n") };
  return result;
}
