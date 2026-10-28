"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission, type CurrentUser } from "@/lib/auth";
import { hasSpecial, scopeFor, type Action } from "@/lib/permissions";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import {
  addExpense,
  addFuel,
  approveWaybill,
  createWaybill,
  createWaybillTx,
  deleteWaybill,
  deleteWaybillItem,
  editWaybill,
  invoiceSelectedWaybills,
  invoiceWaybillsNow,
  patchWaybill,
  recordStage,
  setWaybillStatus,
  type WaybillInput,
  rejectWaybill,
  revertWaybill,
  saveTransportDoc,
  sendTransportDocToDriver,
  updateWaybill,
} from "@/lib/waybills";
import { EXPENSE_BILL_TO, EXPENSE_PAYERS, FUEL_SOURCES, TRIP_STAGES, WAYBILL_FLOW, WAYBILL_STATUS, type WaybillFlowStatus } from "@/data/waybills";
import { parseTransport } from "@/lib/transport-draft";
import type { PanelResult } from "@/components/record-panel";
import { removeWaybillsFromDrafts } from "@/lib/invoices";
import { autoSubmit } from "@/lib/zatca/service";
import type { FormState } from "@/components/action-form";
import type { DocSheetResult, SheetChange } from "@/components/doc-sheet";

/** صلاحية على شحنة محددة؛ صاحب النطاق «الخاص» (السائق) لا يصل إلا لشحناته. */
async function guard(action: Action, waybillId?: number): Promise<CurrentUser> {
  const user = await requirePermission("waybills", action);
  if (waybillId != null && scopeFor(user.perms, "waybills", action) === "own") {
    const [row] = await db
      .select({ userId: s.drivers.userId })
      .from(s.waybills)
      .innerJoin(s.drivers, eq(s.drivers.id, s.waybills.driverId))
      .where(eq(s.waybills.id, waybillId));
    if (row?.userId !== user.id) redirect("/?denied=1");
  }
  return user;
}

const refresh = (id?: number) => {
  revalidatePath("/waybills");
  if (id) revalidatePath(`/waybills/${id}`);
};

const optId = (v: string | undefined) => (v && v.trim() ? Number(v) : null);

export async function saveWaybills(rows: SheetRow[]) {
  const user = await guard("create");
  const prices = hasSpecial(user.perms, "view_prices");
  const result = await saveSheetRows(rows, async (r) => {
    await createWaybill(db, {
      // التاريخ الفارغ = اليوم، كما يظهر في الخلية
      waybillDate: cell.date(r.date, "التاريخ") ?? todayRiyadh(),
      customerId: Number(cell.required(r.customerId, "العميل")),
      routeId: Number(cell.required(r.routeId, "المسار")),
      shipper: cell.required(r.shipper, "المرسل"),
      consignee: cell.required(r.consignee, "المستلم"),
      vehicleId: optId(r.vehicleId),
      trailerId: optId(r.trailerId),
      driverId: optId(r.driverId),
      carrierId: optId(r.carrierId),
      carrierCost: cell.number(r.carrierCost, "تكلفة الناقل"),
      carrierPlate: cell.text(r.carrierPlate),
      // من لا يرى الأسعار لا يُدخلها؛ تؤخذ من العقد
      amount: prices ? cell.number(r.amount, "المبلغ") : null,
      driverCommission: cell.number(r.commission, "العمولة"),
      weightTons: cell.number(r.weight, "الوزن"),
      containerNumber: cell.text(r.container),
      notes: cell.text(r.notes),
      userId: user.id,
    });
  });
  refresh();
  return result;
}

const formNumber = (fd: FormData, key: string) => {
  const v = String(fd.get(key) ?? "").trim();
  if (!v) return null;
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("رقم غير صالح");
  return n;
};

export async function saveWaybillDetails(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await guard("update", id);
  try {
    await updateWaybill(db, id, {
      amount: hasSpecial(user.perms, "view_prices") && fd.has("amount") ? (formNumber(fd, "amount") ?? 0) : undefined,
      driverCommission: fd.has("driverCommission") ? (formNumber(fd, "driverCommission") ?? 0) : undefined,
      carrierCost: fd.has("carrierCost") ? (formNumber(fd, "carrierCost") ?? 0) : undefined,
      trailerId: fd.has("trailerId") ? optId(String(fd.get("trailerId"))) : undefined,
      odometerStart: formNumber(fd, "odometerStart"),
      odometerEnd: formNumber(fd, "odometerEnd"),
      deliveryNoteNumber: String(fd.get("deliveryNoteNumber") ?? ""),
      customsDeclaration: String(fd.get("customsDeclaration") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    });
    refresh(id);
    return { ok: "تم حفظ التعديلات" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function addStage(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await guard("update", id);
  const stage = String(fd.get("stage")) as keyof typeof TRIP_STAGES;
  if (!(stage in TRIP_STAGES)) return { error: "اختر المرحلة" };
  try {
    await recordStage(db, id, stage, { odometer: formNumber(fd, "odometer"), note: String(fd.get("note") ?? ""), userId: user.id });
    refresh(id);
    return { ok: `تم تسجيل مرحلة «${TRIP_STAGES[stage]}»` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function approveOne(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await guard("approve", id);
  try {
    const { entry } = await approveWaybill(db, id, {
      userId: user.id,
      canOverride: hasSpecial(user.perms, "override_controls"),
      overrideReason: String(fd.get("overrideReason") ?? ""),
    });
    refresh(id);
    return { ok: entry ? `اعتُمدت الشحنة ورُحّل القيد ${entry.number}` : "اعتُمدت الشحنة (بلا تكاليف تُقيد)" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function rejectOne(id: number, _: FormState, fd: FormData): Promise<FormState> {
  await guard("approve", id);
  try {
    await rejectWaybill(db, id, String(fd.get("reason") ?? ""));
    refresh(id);
    return { ok: "رُفضت الشحنة وأُعيدت مع السبب" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function revertOne(id: number): Promise<FormState> {
  await guard("revert", id);
  try {
    await revertWaybill(db, id);
    refresh(id);
    return { ok: "أُرجعت الشحنة وأُلغي قيدها" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function deleteOne(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await guard("delete", id);
  try {
    await deleteWaybill(db, id, { reason: String(fd.get("reason") ?? ""), userId: user.id });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect("/waybills");
}

const pick = <T extends Record<string, string>>(map: T, v: string | undefined, label: string) => {
  const key = cell.required(v, label);
  if (!(key in map)) throw new Error(`${label} غير معروف`);
  return key as keyof T & string;
};

export async function saveFuel(id: number, rows: SheetRow[]) {
  await guard("update", id);
  const result = await saveSheetRows(rows, async (r) => {
    const amount = cell.number(r.amount, "المبلغ");
    if (!amount) throw new Error("المبلغ إلزامي");
    await addFuel(db, id, {
      source: pick(FUEL_SOURCES, r.source, "المصدر"),
      partyId: optId(r.partyId),
      liters: cell.number(r.liters, "اللترات"),
      amount,
      vatAmount: cell.number(r.vat, "الضريبة") ?? 0,
      currencyCode: r.currency === "KWD" ? "KWD" : "SAR",
      exchangeRate: cell.number(r.rate, "سعر الصرف"),
      odometer: cell.number(r.odometer, "العداد"),
      invoiceNumber: cell.text(r.invoice),
    });
  });
  refresh(id);
  return result;
}

export async function saveExpenses(id: number, rows: SheetRow[]) {
  await guard("update", id);
  const result = await saveSheetRows(rows, async (r) => {
    const amount = cell.number(r.amount, "المبلغ");
    if (!amount) throw new Error("المبلغ إلزامي");
    await addExpense(db, id, {
      chargeTypeId: Number(cell.required(r.chargeTypeId, "النوع")),
      amount,
      currencyCode: r.currency === "KWD" ? "KWD" : "SAR",
      exchangeRate: cell.number(r.rate, "سعر الصرف"),
      billTo: r.billTo ? pick(EXPENSE_BILL_TO, r.billTo, "على من") : undefined,
      payer: r.payer ? pick(EXPENSE_PAYERS, r.payer, "الدافع") : undefined,
      partyId: optId(r.partyId),
      note: cell.text(r.note),
    });
  });
  refresh(id);
  return result;
}

export async function removeItem(id: number, kind: "fuel" | "expense", itemId: number) {
  await guard("update", id);
  await deleteWaybillItem(db, id, kind, itemId);
  refresh(id);
}

/** حفظ ورقة الشحنات: الشحنات غير المعتمدة فقط، وكل خلية تمر على قواعد تعديل الشحنة نفسها. */
export async function saveWaybillSheet(payload: string): Promise<DocSheetResult> {
  const changes = JSON.parse(payload) as SheetChange[];
  const errors: Record<number, string> = {};
  let saved = 0;
  for (const { id, values: v } of changes) {
    try {
      const user = await guard("update", id);
      const n = (key: string, label: string) => (v[key] === undefined ? undefined : (cell.number(v[key].replace(/[,\s]/g, ""), label) ?? null));
      const ref = (key: string) => (v[key] === undefined ? undefined : optId(v[key]));
      const patch: Partial<Omit<WaybillInput, "userId">> = {
        waybillDate: v.date !== undefined ? (cell.date(v.date, "التاريخ") ?? undefined) : undefined,
        customerId: v.customerId !== undefined ? Number(cell.required(v.customerId, "العميل")) : undefined,
        routeId: v.routeId !== undefined ? Number(cell.required(v.routeId, "المسار")) : undefined,
        vehicleId: ref("vehicleId"),
        driverId: ref("driverId"),
        shipper: v.shipper,
        consignee: v.consignee,
        amount: hasSpecial(user.perms, "view_prices") && v.amount !== undefined ? n("amount", "المبلغ") : undefined,
        driverCommission: n("commission", "العمولة"),
        carrierCost: n("carrierCost", "تكلفة الناقل"),
        weightTons: n("weight", "الوزن"),
        containerNumber: v.container,
        notes: v.notes,
      };
      const core = ["waybillDate", "customerId", "routeId", "vehicleId", "driverId"].some((k) => patch[k as keyof typeof patch] !== undefined);
      if (core) await patchWaybill(db, id, Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined)));
      else
        await updateWaybill(db, id, {
          amount: patch.amount === undefined ? undefined : (patch.amount ?? 0),
          driverCommission: patch.driverCommission === undefined ? undefined : (patch.driverCommission ?? 0),
          carrierCost: patch.carrierCost === undefined ? undefined : (patch.carrierCost ?? 0),
          shipper: patch.shipper,
          consignee: patch.consignee,
          weightTons: patch.weightTons,
          containerNumber: patch.containerNumber,
          notes: patch.notes,
        });
      if (v.deliveryNote !== undefined) await updateWaybill(db, id, { deliveryNoteNumber: v.deliveryNote });
      saved++;
    } catch (err) {
      errors[id] = errorMessage(err);
    }
  }
  revalidatePath("/waybills");
  return { ok: saved ? `حُفظت تعديلات ${saved} شحنة` : undefined, errors };
}

// ───────────── نافذة الإنشاء والتعديل وقائمة العمليات ─────────────

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const numOrNull = (fd: FormData, k: string, label: string) => {
  const v = str(fd, k).replace(/[,\s]/g, "");
  if (!v) return null;
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0) throw new Error(`${label}: رقم غير صالح`);
  return x;
};

function readWaybillForm(fd: FormData, prices: boolean) {
  const carrier = str(fd, "execution") === "carrier";
  return {
    waybillDate: cell.date(str(fd, "date"), "التاريخ") ?? todayRiyadh(),
    customerId: Number(cell.required(str(fd, "customerId"), "العميل")),
    routeId: Number(cell.required(str(fd, "routeId"), "المسار")),
    shipper: str(fd, "shipper"),
    consignee: str(fd, "consignee"),
    vehicleId: carrier ? null : optId(str(fd, "vehicleId")),
    trailerId: carrier ? null : optId(str(fd, "trailerId")),
    driverId: carrier ? null : optId(str(fd, "driverId")),
    carrierId: carrier ? optId(str(fd, "carrierId")) : null,
    carrierCost: carrier ? numOrNull(fd, "carrierCost", "تكلفة الناقل") : null,
    carrierPlate: carrier ? str(fd, "carrierPlate") : null,
    carrierDriverName: carrier ? str(fd, "carrierDriverName") : null,
    // من لا يرى الأسعار لا يُدخلها؛ الفارغ يُحسب من العقد
    amount: prices ? numOrNull(fd, "amount", "المبلغ") : undefined,
    driverCommission: carrier ? null : numOrNull(fd, "commission", "العمولة"),
    weightTons: numOrNull(fd, "weight", "الوزن"),
    containerNumber: str(fd, "container"),
    deliveryNoteNumber: str(fd, "deliveryNote"),
    customsDeclaration: str(fd, "customs"),
    notes: str(fd, "notes"),
  };
}

/** حفظ نافذة الشحنة: إنشاء جديدة أو تعديل كامل قبل الاعتماد. */
export async function saveWaybillPanel(id: number | null, fd: FormData): Promise<PanelResult> {
  const user = await guard(id ? "update" : "create", id ?? undefined);
  const prices = hasSpecial(user.perms, "view_prices");
  try {
    const transport = parseTransport(str(fd, "transport"));
    const input = { ...readWaybillForm(fd, prices), deliveryAddress: transport?.deliveryAddress ?? null };
    let row;
    if (id) {
      const [cur] = await db.select({ amount: s.waybills.amount }).from(s.waybills).where(eq(s.waybills.id, id));
      // من لا يرى الأسعار يبقى سعر الشحنة كما هو
      row = await editWaybill(db, id, { ...input, amount: prices ? input.amount : Number(cur?.amount ?? 0) });
      if (transport) row = await saveTransportDoc(db, id, transport);
    } else {
      // الشحنة ووثيقة نقلها معاً: خطأ في البضاعة لا يترك شحنة ناقصة
      row = await db.transaction(async (tx) => {
        const created = await createWaybillTx(tx, { ...input, amount: input.amount ?? null, userId: user.id });
        if (input.deliveryNoteNumber || input.customsDeclaration)
          await tx.update(s.waybills).set({ deliveryNoteNumber: input.deliveryNoteNumber || null, customsDeclaration: input.customsDeclaration || null }).where(eq(s.waybills.id, created.id));
        return transport ? saveTransportDoc(tx, created.id, transport) : created;
      });
    }
    refresh(row.id);
    return { ok: id ? `حُفظت الشحنة ${row.number}` : `أُنشئت الشحنة ${row.number}`, id: row.id, label: row.number };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** حفظ بيانات وثيقة النقل وحدها (لأي شحنة غير مرفوضة، حتى المعتمدة والمفوترة). */
export async function saveTransportPanel(id: number, fd: FormData): Promise<PanelResult> {
  await guard("update", id);
  try {
    const transport = parseTransport(str(fd, "transport"));
    if (!transport) throw new Error("لا توجد بيانات للحفظ");
    const row = await saveTransportDoc(db, id, transport);
    refresh(id);
    return { ok: `حُفظت وثيقة النقل للشحنة ${row.number}`, id: row.id, label: row.number };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** إرسال وثيقة النقل لتطبيق السائق. */
export async function sendToDriverAction(id: number): Promise<FormState> {
  await guard("update", id);
  try {
    const r = await sendTransportDocToDriver(db, id);
    refresh(id);
    return { ok: `أُرسلت الشحنة إلى ${r.driver ?? "السائق"}؛ تظهر الآن في تطبيقه ليستلمها` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

const isFlow = (v: string): v is WaybillFlowStatus => (WAYBILL_FLOW as readonly string[]).includes(v);

/** نقل شحنة واحدة لحالة (من قائمة العمليات). */
export async function waybillToStatus(id: number, target: WaybillFlowStatus, fd?: FormData): Promise<FormState> {
  const user = await guard(target === "approved" ? "approve" : "update", id);
  try {
    await setWaybillStatus(db, id, target, { userId: user.id, canOverride: hasSpecial(user.perms, "override_controls"), overrideReason: fd ? str(fd, "overrideReason") : undefined });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh(id);
  return { ok: `أصبحت الشحنة «${WAYBILL_STATUS[target].label}»` };
}

export async function rejectWaybillAction(id: number, fd: FormData): Promise<FormState> {
  return rejectOne(id, {}, fd);
}

export async function removeWaybillAction(id: number, back: string, fd: FormData): Promise<FormState> {
  const user = await guard("delete", id);
  try {
    await deleteWaybill(db, id, { reason: str(fd, "reason"), userId: user.id });
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect(back);
}

/** نسخ الشحنة: شحنة جديدة مسودة بتاريخ اليوم وبنفس العميل والمسار والتنفيذ، والسعر من العقد. */
export async function copyWaybill(id: number, back: string): Promise<FormState> {
  const user = await guard("create");
  let newId: number;
  try {
    const [w] = await db.select().from(s.waybills).where(eq(s.waybills.id, id));
    if (!w) throw new Error("الشحنة غير موجودة");
    const row = await createWaybill(db, {
      waybillDate: todayRiyadh(),
      customerId: w.customerId,
      routeId: w.routeId,
      shipper: w.shipper,
      consignee: w.consignee,
      deliveryAddress: w.deliveryAddress,
      vehicleId: w.vehicleId,
      trailerId: w.trailerId,
      driverId: null,
      carrierId: w.carrierId,
      carrierCost: w.carrierCost != null ? Number(w.carrierCost) : null,
      carrierPlate: w.carrierPlate,
      carrierDriverName: w.carrierDriverName,
      amount: w.priceNote && /يدوي/.test(w.priceNote) ? Number(w.amount) : null,
      weightTons: w.weightTons != null ? Number(w.weightTons) : null,
      notes: w.notes,
      userId: user.id,
    });
    newId = row.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  refresh();
  redirect(`${back}${back.includes("?") ? "&" : "?"}edit=${newId}`);
}

const idsOf = (fd: FormData) => [...new Set(fd.getAll("ids").map(Number).filter((x) => Number.isInteger(x) && x > 0))];

/** دمج شحنة واحدة أو المحدد: فاتورة مسودة لكل عميل. */
export async function invoiceWaybills(ids: number[], invoiceDate: string) {
  const user = await requirePermission("sales_invoices", "create");
  const res = await invoiceSelectedWaybills(db, ids, { invoiceDate, userId: user.id });
  revalidatePath("/waybills");
  revalidatePath("/invoices");
  return res;
}

/** فوترة: إصدار فاتورة الشحنات وترحيل قيدها (والإرسال للهيئة إن كان الربط مفعّلاً). */
async function issueWaybills(ids: number[], invoiceDate: string): Promise<FormState> {
  const user = await requirePermission("sales_invoices", "approve");
  try {
    const res = await invoiceWaybillsNow(db, ids, { invoiceDate, userId: user.id });
    const notes: string[] = [];
    for (const inv of res.issued) {
      const zatca = await autoSubmit(db, { invoiceId: inv.id }, user.id);
      if (zatca && !zatca.startsWith("واعتمد")) notes.push(`${inv.number} ${zatca}`);
    }
    revalidatePath("/waybills");
    revalidatePath("/invoices");
    revalidatePath("/");
    const msg = res.issued.length ? `صدرت ${res.issued.length === 1 ? "الفاتورة" : `${res.issued.length} فواتير`} ورُحّل القيد: ${res.issued.map((i) => i.number).join("، ")}${notes.length ? `\nملاحظة: ${notes.join("\n")}` : ""}` : "";
    if (!res.issued.length) return { error: res.skipped.join("\n") || "لم تصدر فاتورة" };
    return res.skipped.length ? { error: `${msg}\nولم يُنفذ:\n${res.skipped.join("\n")}` } : { ok: msg };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** فك الدمج: إخراج الشحنات من مسوداتها فتعود «بانتظار الفوترة». */
async function unmergeWaybills(ids: number[]): Promise<FormState> {
  await requirePermission("sales_invoices", "update");
  const res = await removeWaybillsFromDrafts(db, ids);
  revalidatePath("/waybills");
  revalidatePath("/invoices");
  const msg = res.done.length ? `فُك دمج ${res.done.length} شحنة وعادت «بانتظار الفوترة»` : "";
  if (!res.done.length) return { error: res.skipped.join("\n") || "لا توجد شحنات مدمجة في المحدد" };
  return res.skipped.length ? { error: `${msg}\nولم يُنفذ:\n${res.skipped.join("\n")}` } : { ok: msg };
}

export async function issueOne(id: number, fd: FormData): Promise<FormState> {
  return issueWaybills([id], cell.date(str(fd, "invoiceDate"), "تاريخ الفاتورة") ?? todayRiyadh());
}

export async function unmergeOne(id: number): Promise<FormState> {
  return unmergeWaybills([id]);
}

export async function invoiceOne(id: number, fd: FormData): Promise<FormState> {
  let invoiceId: number | undefined;
  try {
    const res = await invoiceWaybills([id], cell.date(str(fd, "invoiceDate"), "تاريخ الفاتورة") ?? todayRiyadh());
    if (!res.created.length) return { error: res.skipped.join("\n") || "لم تُنشأ فاتورة" };
    invoiceId = res.created[0].id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  redirect(`/invoices?open=${invoiceId}`);
}

/** العمليات على الشحنات المحددة: تغيير الحالة، أو الدمج في مسودة، أو الفوترة، أو فك الدمج. */
export async function bulkWaybillOps(_: FormState, fd: FormData): Promise<FormState> {
  const op = str(fd, "op");
  const ids = idsOf(fd).slice(0, 500);
  if (!ids.length) return { error: "حدد شحنة واحدة على الأقل من الجدول" };
  if (op === "invoice") return issueWaybills(ids, cell.date(str(fd, "invoiceDate"), "تاريخ الفاتورة") ?? todayRiyadh());
  if (op === "unmerge") return unmergeWaybills(ids);
  if (op === "merge") {
    try {
      const res = await invoiceWaybills(ids, cell.date(str(fd, "invoiceDate"), "تاريخ الفاتورة") ?? todayRiyadh());
      const made = res.created.map((c) => `${c.number} (${c.count} شحنة)`).join("، ");
      const msg = made ? `دُمجت في ${res.created.length === 1 ? "الفاتورة المسودة" : "الفواتير المسودة"}: ${made}` : "";
      if (!res.created.length) return { error: res.skipped.join("\n") || "لم تُنشأ فاتورة" };
      return res.skipped.length ? { error: `${msg}\nولم تُدمج:\n${res.skipped.join("\n")}` } : { ok: `${msg}. الخطوة التالية: «فوترة المحدد» أو اعتمادها من الفواتير` };
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }
  if (op === "send_driver") {
    await guard("update");
    let sent = 0;
    const failed: string[] = [];
    const already = new Set(
      (await db.select({ id: s.waybills.id, number: s.waybills.number, at: s.waybills.sentToDriverAt }).from(s.waybills).where(inArray(s.waybills.id, ids)))
        .filter((w) => w.at)
        .map((w) => {
          failed.push(`${w.number}: أُرسلت للسائق من قبل (لإعادة الإرسال افتح عملياتها)`);
          return w.id;
        }),
    );
    for (const id of ids) {
      if (already.has(id)) continue;
      try {
        await guard("update", id);
        await sendTransportDocToDriver(db, id);
        sent++;
      } catch (err) {
        failed.push(errorMessage(err));
      }
    }
    refresh();
    const what = `أُرسلت ${sent} شحنة للسائقين؛ تظهر في تطبيقاتهم ليستلموها`;
    if (!sent) return { error: failed.join("\n") };
    return failed.length ? { error: `${what}، ولم تُرسل ${failed.length}:\n${failed.join("\n")}` } : { ok: what };
  }
  if (!isFlow(op)) return { error: "اختر العملية" };
  const user = await guard(op === "approved" ? "approve" : "update");
  const canOverride = hasSpecial(user.perms, "override_controls");
  const reason = str(fd, "overrideReason");
  let ok = 0;
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await guard(op === "approved" ? "approve" : "update", id);
      await setWaybillStatus(db, id, op, { userId: user.id, canOverride, overrideReason: reason });
      ok++;
    } catch (err) {
      failed.push(errorMessage(err));
    }
  }
  refresh();
  const what = `أصبحت «${WAYBILL_STATUS[op].label}» ${ok} شحنة`;
  if (!ok) return { error: failed.join("\n") };
  return failed.length ? { error: `${what}، ولم يُنفذ على ${failed.length}:\n${failed.join("\n")}` } : { ok: what };
}
