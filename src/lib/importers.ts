import { and, eq, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { CHARGE_SLOTS, type ImportSpec } from "@/data/import-specs";
import { addInvoiceChargesTx, createDirectInvoiceTx } from "@/lib/invoices";
import type { InvoiceTripInput } from "@/lib/waybills";
import { createQuotationTx } from "@/lib/quotations";
import { createBulkWaybillTx, type BulkCharge } from "@/lib/waybill-bulk";
import { createVehicle } from "@/lib/fleet";
import { createParty } from "@/lib/operations";
import { createReceipt } from "@/lib/receipts";
import { createManualEntry } from "@/lib/journal";
import { createViolation } from "@/lib/violations";
import { createProduct, openingStockTx } from "@/lib/inventory";
import { createAsset } from "@/lib/assets";
import { addMaintenanceLines, createBreakdownRequest, createMaintenanceOrder, savePlan } from "@/lib/maintenance";
import { MAINTENANCE_TYPES, type MaintenanceType } from "@/data/maintenance";
import { lineVat, round2 } from "@/lib/invoice-posting";
import { errorMessage } from "@/lib/errors";
import { todayRiyadh } from "@/lib/dates";
import { plateKey } from "@/lib/plates";
import { normText, type ImportIssue, type ImportReport } from "@/lib/import-match";
import type { TemplateList } from "@/lib/xlsx";
import { normalizeTaxName } from "@/data/tax-codes";
import { splitCustom } from "@/data/custom-lists";
import { customListOptions } from "@/lib/custom-lists";

// تنفيذ الاستيراد: كل سجل (فاتورة بكل بنودها، أو مركبة، أو عميل) في نقطة حفظ مستقلة داخل
// معاملة واحدة، فيُرفض السجل الخاطئ وحده. في وضع «التحقق» تُلغى المعاملة كلها في النهاية.

export interface ImportRow {
  row: number;
  values: Record<string, string>;
}

type Missing = NonNullable<ImportIssue["missing"]>;

class MissingRef extends Error {
  constructor(
    public missing: Missing,
    message: string,
  ) {
    super(message);
  }
}

const DRY_RUN = Symbol("dry-run");

const v = (r: ImportRow, key: string) => (r.values[key] ?? "").trim();

function required(r: ImportRow, key: string, label: string) {
  const t = v(r, key);
  if (!t) throw new Error(`${label} مطلوب`);
  return t;
}

function toNumber(raw: string, label: string, opts: { min?: number; max?: number; positive?: boolean } = {}) {
  const t = raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[,\s٬]/g, "").replace("٫", ".").replace(/%$/, "");
  const n = Number(t);
  if (!t || !Number.isFinite(n)) throw new Error(`${label}: «${raw}» ليس رقماً`);
  if (opts.positive && !(n > 0)) throw new Error(`${label} يجب أن يكون أكبر من صفر`);
  if (opts.min != null && n < opts.min) throw new Error(`${label}: الحد الأدنى ${opts.min}`);
  if (opts.max != null && n > opts.max) throw new Error(`${label}: الحد الأقصى ${opts.max}`);
  return n;
}

/** يقبل 2026-10-05 أو 05/10/2026 أو 5-10-2026، أو رقم التاريخ في Excel (خلية تاريخ بتنسيق «عام» مثل 46300). */
export function toDate(raw: string, label: string) {
  const t = raw.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (/^\d{5}$/.test(t) && Number(t) > 20000 && Number(t) < 80000) return new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000).toISOString().slice(0, 10);
  const dmy = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const ymd = t.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : ymd ? `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}` : "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (!iso || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new Error(`${label}: «${raw}» ليس تاريخاً صحيحاً`);
  return iso;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** فهرس بحث بالنص الموحد؛ القيمة المكررة بمعنيين تُعلَّم غامضة. */
class Index<T> {
  private map = new Map<string, T | null>();
  add(keys: (string | null | undefined)[], value: T) {
    for (const k of keys) {
      if (!k) continue;
      const n = normText(k);
      if (!n) continue;
      const prev = this.map.get(n);
      this.map.set(n, prev !== undefined && prev !== value ? null : value);
    }
  }
  find(raw: string): T | undefined | null {
    return this.map.get(normText(raw));
  }
}

/** فهرس الضرائب: يقبل الاسم كما يصدّره وافق «… (15.00%)». */
class TaxIndex<T> extends Index<T> {
  find(raw: string) {
    return super.find(raw) ?? super.find(normalizeTaxName(raw));
  }
}

async function lookups(tx: Tx) {
  const [allAccounts, customers, parties, currencies, taxCodes, costCenters, vehicles, vehicleTypes] = await Promise.all([
    tx.select().from(s.accounts),
    tx.select({ id: s.parties.id, nameAr: s.parties.nameAr, nameEn: s.parties.nameEn }).from(s.parties).innerJoin(s.partyRoles, and(eq(s.partyRoles.partyId, s.parties.id), eq(s.partyRoles.role, "customer"))),
    tx.select({ id: s.parties.id, nameAr: s.parties.nameAr }).from(s.parties),
    tx.select().from(s.currencies),
    tx.select().from(s.taxCodes).where(eq(s.taxCodes.isActive, true)),
    tx.select().from(s.costCenters),
    tx.select({ id: s.vehicles.id, plate: s.vehicles.plate, chassis: s.vehicles.chassis, costCenterId: s.vehicles.costCenterId }).from(s.vehicles),
    tx.select().from(s.vehicleTypes),
  ]);
  const accounts = allAccounts.filter((a) => a.isPostable && a.isActive);
  const idx = {
    accounts: new Index<(typeof accounts)[number]>(),
    // الحسابات الرئيسية والموقوفة: لرسالة أوضح من «غير موجود»
    otherAccounts: new Index<(typeof accounts)[number]>(),
    customers: new Index<number>(),
    parties: new Index<number>(),
    currencies: new Index<string>(),
    taxCodes: new TaxIndex<(typeof taxCodes)[number]>(),
    costCenters: new Index<number>(),
    plates: new Set(vehicles.map((x) => plateKey(x.plate))),
    // اللوحات التي أُضيفت من الملف نفسه (لتمييز «مكررة في الملف» عن «مسجلة مسبقاً»)
    filePlates: new Set<string>(),
    chassis: new Set(vehicles.flatMap((x) => (x.chassis ? [normText(x.chassis)] : []))),
    vehicleTypes: new Index<number>(),
    vehicles: new Index<number>(),
  };
  for (const a of accounts) idx.accounts.add([a.code, a.nameAr, a.nameEn, `${a.code} ${a.nameAr}`], a);
  for (const a of allAccounts) if (!a.isPostable || !a.isActive) idx.otherAccounts.add([a.code, a.nameAr, a.nameEn, `${a.code} ${a.nameAr}`], a);
  for (const c of customers) idx.customers.add([c.nameAr, c.nameEn], c.id);
  for (const p of parties) idx.parties.add([p.nameAr], p.id);
  for (const c of currencies) idx.currencies.add([c.code, c.nameAr], c.code);
  // ضرائب المبيعات بأسمائها في وافق (مع «(15.00%)» أو دونها) أو برمزها، والأسماء القديمة تبقى
  const outTax = taxCodes.filter((t) => t.side !== "purchases");
  const byCode = (code: string) => outTax.find((t) => t.code === code);
  for (const t of outTax) idx.taxCodes.add([t.code, t.nameAr, normalizeTaxName(t.nameAr)], t);
  const purchaseTax = new TaxIndex<(typeof taxCodes)[number]>();
  for (const t of taxCodes.filter((x) => x.side === "purchases")) purchaseTax.add([t.code, t.nameAr, normalizeTaxName(t.nameAr)], t);
  const vat = byCode("VAT15-OUT");
  const zero = byCode("ZERO");
  const exempt = byCode("EXEMPT");
  if (vat) idx.taxCodes.add(["15", "15%", "vat", "vat on sales", "ضريبة القيمة المضافة", "ضريبة القيمة المضافة 15%", "خاضع"], vat);
  if (zero) idx.taxCodes.add(["0", "0%", "صفر", "zero", "zero rated", "نسبة صفر", "صفري"], zero);
  if (exempt) idx.taxCodes.add(["معفى", "معفي", "exempt", "exempted"], exempt);
  for (const c of costCenters) idx.costCenters.add([c.code, c.nameAr], c.id);
  for (const x of vehicles) idx.costCenters.add([x.plate], x.costCenterId);
  for (const x of vehicles) idx.vehicles.add([x.plate], x.id);
  for (const t of vehicleTypes) idx.vehicleTypes.add([t.nameAr], t.id);
  const purchaseTaxNames = taxCodes.filter((x) => x.side === "purchases").map((x) => x.nameAr);
  return { idx, purchaseTax, purchaseTaxNames, defaultTax: vat ?? null, accounts, customers, currencies, outTax, costCenters, vehicles, vehicleTypes };
}

type Ctx = Awaited<ReturnType<typeof lookups>> & { post?: boolean };

function resolve<T>(found: T | undefined | null, raw: string, kind: Missing["kind"], label: string): T {
  if (found === null) throw new Error(`${label} «${raw}» يطابق أكثر من سجل؛ استخدم الرقم أو الرمز`);
  if (found === undefined) throw new MissingRef({ kind, value: raw }, `${label} «${raw}» غير موجود في النظام`);
  return found;
}

/** الحساب بالرقم أو الاسم؛ الحساب الرئيسي أو الموقوف يُرفض برسالة تقول السبب. */
function findAccount(ctx: Ctx, raw: string, label: string) {
  const found = ctx.idx.accounts.find(raw);
  if (found === undefined) {
    const other = ctx.idx.otherAccounts.find(raw);
    if (other && !other.isPostable) throw new Error(`${label} «${raw}» حساب رئيسي لا يُقيد عليه؛ اختر حساباً فرعياً تحته (مثل ${ctx.accounts.find((a) => a.code.startsWith(other.code))?.code ?? `${other.code}01`})`);
    if (other) throw new Error(`${label} «${raw}» موقوف؛ فعّله من شجرة الحسابات أو اختر غيره`);
  }
  return resolve(found, raw, "account", label);
}

// ───────────── فواتير البيع ─────────────

async function importInvoice(tx: Tx, rows: ImportRow[], ctx: Ctx, userId?: number) {
  const head = rows[0];
  const reference = required(head, "reference", "رقم الفاتورة");
  const customerName = required(head, "customer", "اسم العميل");
  const customerId = resolve(ctx.idx.customers.find(customerName), customerName, "customer", "العميل");
  const currencyRaw = required(head, "currency", "العملة");
  const currencyCode = resolve(ctx.idx.currencies.find(currencyRaw), currencyRaw, "currency", "العملة");
  const invoiceDate = toDate(required(head, "invoiceDate", "التاريخ"), "التاريخ");
  const dueDate = v(head, "dueDate") ? toDate(v(head, "dueDate"), "تاريخ الاستحقاق") : addDays(invoiceDate, 30);
  if (dueDate < invoiceDate) throw new Error("تاريخ الاستحقاق قبل تاريخ الفاتورة");
  // كل بنود الفاتورة يجب أن تتفق في بياناتها الرئيسية
  for (const r of rows.slice(1)) {
    for (const [key, label] of [["customer", "اسم العميل"], ["currency", "العملة"], ["invoiceDate", "التاريخ"]] as const) {
      if (v(r, key) && normText(v(r, key)) !== normText(v(head, key))) throw new Error(`${label} يختلف بين بنود الفاتورة ${reference} (الصف ${r.row})`);
    }
  }
  const inclusive = /شامل|inc/i.test(v(head, "taxInclusive")) && !/خال|خالي|exc/i.test(v(head, "taxInclusive"));

  // الصف الذي فيه رقم شحنة يُدخلها بسعرها ومصاريفها؛ خانات البند تبقى فارغة حتى لا يتضاعف الإيراد
  const waybillIds: number[] = [];
  for (const r of rows) {
    const no = v(r, "waybill");
    if (!no) continue;
    const at = rows.length > 1 ? ` (الصف ${r.row})` : "";
    if (v(r, "unitPrice") || v(r, "quantity")) throw new Error(`رقم الشحنة ${no}: اترك الكمية والسعر فارغين، فالشحنة تدخل بسعرها${at}`);
    const [w] = await tx.select({ id: s.waybills.id, status: s.waybills.status, customerId: s.waybills.customerId }).from(s.waybills).where(eq(s.waybills.number, no)).limit(1);
    if (!w) throw new Error(`رقم الشحنة «${no}» غير موجود${at}`);
    if (w.customerId !== customerId) throw new Error(`رقم الشحنة ${no} لعميل آخر${at}`);
    if (w.status !== "approved") throw new Error(`رقم الشحنة ${no} غير معتمدة أو مفوترة؛ اعتمدها أولاً${at}`);
    if (waybillIds.includes(w.id)) throw new Error(`رقم الشحنة ${no} مكرر في الفاتورة${at}`);
    waybillIds.push(w.id);
  }

  const lines = rows.filter((r) => !v(r, "waybill")).map((r) => {
    const at = rows.length > 1 ? ` (الصف ${r.row})` : "";
    const description = required(r, "description", `وصف البند${at}`);
    const quantity = toNumber(required(r, "quantity", `الكمية${at}`), `الكمية${at}`, { positive: true });
    const unitPrice = toNumber(required(r, "unitPrice", `السعر${at}`), `السعر${at}`, { min: 0 });
    const discountPercent = v(r, "discount") ? toNumber(v(r, "discount"), `الخصم${at}`, { min: 0, max: 100 }) : 0;
    const accRaw = required(r, "account", `حساب البند${at}`);
    const account = findAccount(ctx, accRaw, `الحساب${at}`);
    if (account.type !== "revenue") throw new Error(`الحساب ${account.code} ${account.nameAr} ليس حساب إيراد${at}`);
    const taxRaw = v(r, "taxCode");
    const tax = taxRaw ? resolve(ctx.idx.taxCodes.find(taxRaw), taxRaw, "taxCode", `معدل الضريبة${at}`) : ctx.defaultTax;
    const vatRate = Number(tax?.rate ?? 0);
    const ccRaw = v(r, "costCenter");
    const costCenterId = ccRaw ? resolve(ctx.idx.costCenters.find(ccRaw), ccRaw, "costCenter", `مركز التكلفة${at}`) : null;
    if (account.requiresCostCenter && !costCenterId) throw new Error(`الحساب ${account.code} يتطلب مركز تكلفة أو مركبة${at}`);
    const net = round2(quantity * unitPrice * (1 - discountPercent / 100));
    const amount = inclusive ? round2(net / (1 + vatRate / 100)) : net;
    const vatAmount = inclusive ? round2(net - amount) : lineVat(amount, vatRate);
    return { description, quantity, unitPrice, discountPercent, amount, vatAmount, vatRate, taxCodeId: tax?.id ?? null, accountId: account.id, costCenterId };
  });
  if (!waybillIds.length && !(lines.reduce((t, l) => t + l.amount + l.vatAmount, 0) > 0)) throw new Error(`إجمالي الفاتورة ${reference} صفر`);

  // رحلة الفاتورة المباشرة (من أول صف): تُنشأ للسائق كما في نافذة الفاتورة
  const needsLook = v(head, "tripVehicle") || rows.some((r) => CHARGE_SLOTS.some((n) => v(r, `charge${n}`) || v(r, `charge${n}Amount`) || v(r, `charge${n}From`)));
  const look = needsLook ? await wbLook(tx, ctx) : null;
  let trip: InvoiceTripInput | null = null;
  const tripPlate = v(head, "tripVehicle");
  if (tripPlate) {
    if (waybillIds.length) throw new Error("بيانات الرحلة للفاتورة المباشرة فقط؛ الشحنة المفوترة لها رحلتها");
    const vehicleId = ctx.idx.vehicles.find(tripPlate);
    if (vehicleId == null) throw new Error(`مركبة الرحلة «${tripPlate}» غير موجودة أو مكررة`);
    const driverName = v(head, "tripDriver");
    const driverId = driverName ? look!.driver.find(driverName) : null;
    if (driverName && driverId == null) throw new Error(`سائق الرحلة «${driverName}» غير موجود أو مكرر`);
    trip = {
      vehicleId,
      driverId: driverId ?? null,
      routeId: findRoute(look!, required(head, "tripFrom", "مدينة تحميل الرحلة"), required(head, "tripTo", "مدينة تسليم الرحلة")),
      shipper: required(head, "tripShipper", "مرسل الرحلة"),
      consignee: required(head, "tripConsignee", "مستلم الرحلة"),
      tripCustody: v(head, "tripCustody") ? toNumber(v(head, "tripCustody"), "عهدة الرحلة", { min: 0 }) : null,
    };
  } else {
    for (const key of ["tripDriver", "tripFrom", "tripTo", "tripShipper", "tripConsignee", "tripCustody"]) {
      if (v(head, key)) throw new Error("اكتب مركبة الرحلة مع بيانات الرحلة");
    }
  }
  const charges = look ? rows.flatMap((r) => rowCharges(r, ctx, look)) : [];

  const inv = await createDirectInvoiceTx(tx, { customerId, invoiceDate, dueDate, currencyCode, reference, notes: v(head, "notes") || null, userId, lines, waybillIds, trip, hasCharges: charges.length > 0 });
  if (charges.length) await addInvoiceChargesTx(tx, inv.id, charges.map((c) => ({ ...c, currencyCode })), userId);
  const extra = [waybillIds.length && `${waybillIds.length} شحنة`, charges.length && `${charges.length} مصروف على العميل`, trip && "رحلة"].filter(Boolean).join("، ");
  return `${inv.number} ← ${reference}${extra ? ` (${extra})` : ""}`;
}

// ───────────── عروض الأسعار ─────────────

async function importQuotation(tx: Tx, rows: ImportRow[], ctx: Ctx, userId?: number) {
  const head = rows[0];
  const reference = required(head, "reference", "رقم العرض");
  const customerName = required(head, "customer", "اسم العميل");
  const customerId = resolve(ctx.idx.customers.find(customerName), customerName, "customer", "العميل");
  const currencyRaw = v(head, "currency") || "SAR";
  const currencyCode = resolve(ctx.idx.currencies.find(currencyRaw), currencyRaw, "currency", "العملة");
  const date = toDate(required(head, "date", "التاريخ"), "التاريخ");
  const validUntil = v(head, "validUntil") ? toDate(v(head, "validUntil"), "صالح حتى") : addDays(date, 15);
  const shipRaw = normText(v(head, "shippingType"));
  const shippingType = !shipRaw || /دولي|خارج|international|export/.test(shipRaw) ? "international" : /داخل|محلي|domestic|local/.test(shipRaw) ? "domestic" : null;
  if (!shippingType) throw new Error(`نوع الشحن «${v(head, "shippingType")}» غير معروف؛ اكتب دولي أو داخلي`);
  for (const r of rows.slice(1)) {
    for (const [key, label] of [["customer", "اسم العميل"], ["date", "التاريخ"], ["shippingType", "نوع الشحن"]] as const) {
      if (v(r, key) && normText(v(r, key)) !== normText(v(head, key))) throw new Error(`${label} يختلف بين بنود العرض ${reference} (الصف ${r.row})`);
    }
  }
  const [dup] = await tx.select({ number: s.quotations.number }).from(s.quotations).where(eq(s.quotations.reference, reference)).limit(1);
  if (dup) throw new Error(`العرض ${reference} مستورد مسبقاً برقم ${dup.number}`);
  const lines = rows.map((r) => {
    const at = rows.length > 1 ? ` (الصف ${r.row})` : "";
    const taxRaw = v(r, "taxCode");
    const tax = taxRaw ? resolve(ctx.idx.taxCodes.find(taxRaw), taxRaw, "taxCode", `معدل الضريبة${at}`) : null;
    return {
      description: required(r, "description", `وصف البند${at}`),
      quantity: toNumber(required(r, "quantity", `الكمية${at}`), `الكمية${at}`, { positive: true }),
      unitPrice: toNumber(required(r, "unitPrice", `السعر${at}`), `السعر${at}`, { positive: true }),
      vatRate: tax ? Number(tax.rate) : null,
    };
  });
  const q = await createQuotationTx(tx, { customerId, date, validUntil, currencyCode, shippingType, reference, notes: v(head, "notes"), terms: v(head, "terms"), lines, userId });
  return `${q.number} ← ${reference}`;
}

// ───────────── الشحنات ─────────────

async function waybillLookups(tx: Tx) {
  const [routes, drivers, carriers, chargeTypes, brokers] = await Promise.all([
    tx.execute(sql`select r.id, a.name_ar as "from", b.name_ar as "to", ca.name_ar as "fromCountry", cb.name_ar as "toCountry"
      from routes r join locations a on a.id = r.from_location_id join locations b on b.id = r.to_location_id
      left join locations ca on ca.id = a.parent_id left join locations cb on cb.id = b.parent_id where r.is_active`) as unknown as Promise<{ id: number; from: string; to: string; fromCountry: string | null; toCountry: string | null }[]>,
    tx.select({ id: s.drivers.id, name: s.employees.nameAr }).from(s.drivers).innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId)),
    tx.select({ id: s.parties.id, nameAr: s.parties.nameAr }).from(s.parties).innerJoin(s.partyRoles, and(eq(s.partyRoles.partyId, s.parties.id), eq(s.partyRoles.role, "carrier"))),
    tx.select({ id: s.chargeTypes.id, nameAr: s.chargeTypes.nameAr }).from(s.chargeTypes).where(eq(s.chargeTypes.isActive, true)),
    tx.select({ id: s.parties.id, nameAr: s.parties.nameAr }).from(s.parties).innerJoin(s.partyRoles, and(eq(s.partyRoles.partyId, s.parties.id), eq(s.partyRoles.role, "customs_broker"))),
  ]);
  const route = new Index<number>();
  for (const r of routes) {
    for (const f of [r.from, r.fromCountry]) for (const t of [r.to, r.toCountry]) if (f && t) route.add([`${f}|${t}`], Number(r.id));
  }
  const driver = new Index<number>();
  for (const d of drivers) driver.add([d.name], d.id);
  const carrier = new Index<number>();
  for (const c of carriers) carrier.add([c.nameAr], c.id);
  // مكونات السعر بأسمائها (الأساسية والمضافة)، والقيمة «الأساسي~رقم»
  const components = new Index<string>();
  for (const o of await customListOptions(tx, "price_component")) components.add([o.label, o.label.replace(/\s*\(.*\)\s*$/, ""), o.value.includes("~") ? null : o.value], o.value);
  const chargeType = new Index<number>();
  for (const c of chargeTypes) chargeType.add([c.nameAr], c.id);
  const broker = new Index<number>();
  for (const b of brokers) broker.add([b.nameAr], b.id);
  return { route, driver, carrier, components, chargeType, broker };
}

type WbLook = Awaited<ReturnType<typeof waybillLookups>>;

async function wbLook(tx: Tx, ctx: Ctx) {
  const look = wbCache.get(ctx) ?? (await waybillLookups(tx));
  wbCache.set(ctx, look);
  return look;
}

/** المسار بمدينتي التحميل والتسليم. */
function findRoute(look: WbLook, from: string, to: string) {
  const routeId = look.route.find(`${from}|${to}`);
  if (routeId === null) throw new Error(`أكثر من مسار من ${from} إلى ${to}؛ وحّد المسارات أولاً`);
  if (routeId === undefined) throw new Error(`لا يوجد مسار من ${from} إلى ${to}؛ أضفه من المسارات أولاً`);
  return routeId;
}

/**
 * مصاريف على العميل من الصف (حتى ثلاثة): النوع والمبلغ ومن دفع. الشركة من حساب في الشجرة، أو المخلص باسمه.
 * ما دفعه السائق من عهدته لا يُكتب هنا: يُحمَّل من إيصاله في التطبيق حتى لا يتكرر (قرار أحمد 2026-11-18).
 */
function rowCharges(r: ImportRow, ctx: Ctx, look: WbLook): BulkCharge[] {
  return CHARGE_SLOTS.flatMap((n): BulkCharge[] => {
    const typeRaw = v(r, `charge${n}`);
    const amountRaw = v(r, `charge${n}Amount`);
    const payerRaw = normText(v(r, `charge${n}Payer`));
    const fromRaw = v(r, `charge${n}From`);
    if (!typeRaw && !amountRaw && !payerRaw && !fromRaw) return [];
    const chargeTypeId = look.chargeType.find(required(r, `charge${n}`, `مصروف على العميل ${n}`));
    if (chargeTypeId == null) throw new Error(`مصروف على العميل ${n} «${typeRaw}» غير موجود في أنواع المصروفات (أضفه من «+ إضافة» في نافذة الشحنة) أو مكرر`);
    const amount = toNumber(required(r, `charge${n}Amount`, `مبلغ المصروف ${n}`), `مبلغ المصروف ${n}`, { positive: true });
    if (/سائق|عهد|driver|custody/.test(payerRaw)) throw new Error(`دافع المصروف ${n}: ما دفعه السائق من عهدته يُحمَّل من إيصاله في التطبيق، لا يُكتب في الملف`);
    const from = required(r, `charge${n}From`, `حساب أو مخلص المصروف ${n}`);
    const isBroker = /مخلص|broker/.test(payerRaw) || (!payerRaw && look.broker.find(from) != null);
    if (payerRaw && !isBroker && !/شرك|company|صندوق|بنك|cash|bank/.test(payerRaw)) throw new Error(`دافع المصروف ${n} «${v(r, `charge${n}Payer`)}» غير معروف؛ اكتب الشركة أو المخلص`);
    if (isBroker) {
      const partyId = look.broker.find(from);
      if (partyId == null) throw new Error(`حساب أو مخلص المصروف ${n}: المخلص «${from}» غير موجود في جهات الاتصال أو مكرر`);
      return [{ chargeTypeId, amount, payer: "customs_broker" as const, partyId }];
    }
    const account = findAccount(ctx, from, `حساب أو مخلص المصروف ${n}`);
    if (!/^[12]/.test(account.code) || account.code === "1114") throw new Error(`حساب أو مخلص المصروف ${n}: الحساب ${account.code} ليس صندوقاً أو بنكاً أو التزاماً (اختر حساباً من الأصول أو الالتزامات غير 1114)`);
    return [{ chargeTypeId, amount, payer: "cash" as const, cashAccountId: account.id }];
  });
}

const wbCache: WeakMap<Ctx, Awaited<ReturnType<typeof waybillLookups>>> = new WeakMap();

async function importWaybill(tx: Tx, [r]: ImportRow[], ctx: Ctx, userId?: number) {
  const look = await wbLook(tx, ctx);
  const customerName = required(r, "customer", "العميل");
  const customerId = resolve(ctx.idx.customers.find(customerName), customerName, "customer", "العميل");
  const routeId = findRoute(look, required(r, "from", "من"), required(r, "to", "إلى"));
  const plate = v(r, "vehicle");
  const carrierName = v(r, "carrier");
  if (plate && carrierName) throw new Error("اكتب المركبة أو الناقل الخارجي، لا الاثنين");
  const vehicleId = plate ? ctx.idx.vehicles.find(plate) : null;
  if (plate && vehicleId == null) throw new Error(`المركبة «${plate}» غير موجودة أو مكررة`);
  const trailerPlate = v(r, "trailer");
  const trailerId = trailerPlate ? ctx.idx.vehicles.find(trailerPlate) : null;
  if (trailerPlate && trailerId == null) throw new Error(`المقطورة «${trailerPlate}» غير موجودة أو مكررة`);
  const carrierId = carrierName ? look.carrier.find(carrierName) : null;
  if (carrierName && carrierId == null) throw new Error(`الناقل «${carrierName}» غير موجود أو مكرر في جهات الاتصال`);
  const driverName = v(r, "driver");
  const driverId = driverName ? look.driver.find(driverName) : null;
  if (driverName && driverId == null) throw new Error(`السائق «${driverName}» غير موجود أو مكرر`);
  const optNumber = (key: string, label: string) => (v(r, key) ? toNumber(v(r, key), label, { min: 0 }) : null);
  const charges = rowCharges(r, ctx, look);
  const w = await createBulkWaybillTx(tx, {
    waybillDate: toDate(required(r, "date", "التاريخ"), "التاريخ"),
    customerId,
    routeId,
    shipper: required(r, "shipper", "المرسل"),
    consignee: required(r, "consignee", "المستلم"),
    vehicleId,
    trailerId: trailerId ?? null,
    driverId: driverId ?? null,
    carrierId: carrierId ?? null,
    carrierCost: v(r, "carrierCost") ? toNumber(v(r, "carrierCost"), "تكلفة الناقل", { positive: true }) : null,
    carrierPlate: v(r, "carrierPlate") || null,
    carrierDriverName: v(r, "carrierDriver") || null,
    amount: optNumber("amount", "المبلغ"),
    driverCommission: optNumber("commission", "عمولة السائق"),
    tripCustody: optNumber("tripCustody", "عهدة الرحلة"),
    priceComponents: [1, 2, 3].flatMap((n) => {
      const name = v(r, `comp${n}`);
      if (!name) return [];
      const kind = look.components.find(name);
      if (!kind) throw new Error(`مكون السعر «${name}» غير موجود في القائمة`);
      const { base, classId } = splitCustom(kind);
      return [{ kind: base!, classId, quantity: v(r, `comp${n}Qty`) ? toNumber(v(r, `comp${n}Qty`), `كمية المكون ${n}`, { positive: true }) : 1, unitPrice: toNumber(required(r, `comp${n}Price`, `سعر المكون ${n}`), `سعر المكون ${n}`, { positive: true }) }];
    }),
    taxCodeId: v(r, "taxCode") ? resolve(ctx.idx.taxCodes.find(v(r, "taxCode")), v(r, "taxCode"), "taxCode", "نوع الضريبة").id : null,
    weightTons: optNumber("weight", "الوزن"),
    containerNumber: v(r, "container") || null,
    deliveryAddress: v(r, "deliveryAddress") || null,
    deliveryNoteNumber: v(r, "deliveryNote") || null,
    customsDeclaration: v(r, "customs") || null,
    charges,
    notes: v(r, "notes") || null,
    userId,
  });
  return charges.length ? `${w.number} (+${charges.length} مصروف على العميل)` : w.number;
}

// ───────────── المركبات ─────────────

async function importVehicle(tx: Tx, [r]: ImportRow[], ctx: Ctx) {
  const plate = required(r, "plate", "اللوحة");
  const chassis = v(r, "chassis") || null;
  // تُكتشف المكررة مع المسجلة مسبقاً ومع صفوف الملف نفسه
  if (ctx.idx.filePlates.has(plateKey(plate))) throw new Error(`اللوحة ${plate} مكررة في الملف`);
  if (ctx.idx.plates.has(plateKey(plate))) throw new Error(`اللوحة ${plate} مسجلة مسبقاً`);
  if (chassis && ctx.idx.chassis.has(normText(chassis))) throw new Error(`رقم الشاسيه ${chassis} مسجل مسبقاً`);
  const accRaw = required(r, "assetAccount", "حساب الأصل");
  const account = findAccount(ctx, accRaw, "حساب الأصل");
  if (account.type !== "asset") throw new Error(`الحساب ${account.code} ${account.nameAr} ليس حساب أصل`);
  const typeRaw = v(r, "vehicleType");
  const vehicleTypeId = typeRaw ? resolve(ctx.idx.vehicleTypes.find(typeRaw), typeRaw, "vehicleType", "فئة المركبة") : null;
  const year = v(r, "year") ? toNumber(v(r, "year"), "سنة الصنع", { min: 1980, max: 2100 }) : null;
  const own = normText(v(r, "ownership"));
  if (own && !/^(مملوك|مملوكه|owned|مستاجر|مستاجره|leased|ايجار)$/.test(own)) throw new Error(`الملكية «${v(r, "ownership")}»: اكتب مملوكة أو مستأجرة`);
  const vehicle = await createVehicle(tx, {
    plate,
    chassis,
    assetAccountId: account.id,
    vehicleTypeId,
    make: v(r, "make") || null,
    model: v(r, "model") || null,
    year: year == null ? null : Math.trunc(year),
    ownership: /مستاجر|leased|ايجار/.test(own) ? "leased" : "owned",
    odometer: v(r, "odometer") ? Math.trunc(toNumber(v(r, "odometer"), "العداد", { min: 0 })) : 0,
  });
  ctx.idx.filePlates.add(plateKey(plate));
  if (chassis) ctx.idx.chassis.add(normText(chassis));
  return vehicle.plate;
}

// ───────────── العملاء ─────────────

async function importCustomer(tx: Tx, [r]: ImportRow[], ctx: Ctx) {
  const nameAr = required(r, "nameAr", "اسم العميل");
  if (ctx.idx.parties.find(nameAr) !== undefined) throw new Error(`«${nameAr}» مسجل مسبقاً في جهات الاتصال`);
  const vatNumber = v(r, "vatNumber").replace(/\s/g, "");
  if (vatNumber && !/^\d{15}$/.test(vatNumber)) throw new Error("الرقم الضريبي 15 رقماً");
  const country = (v(r, "country") || "SA").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error(`الدولة «${v(r, "country")}»: رمز من حرفين مثل SA`);
  const curRaw = v(r, "currency") || "SAR";
  const defaultCurrency = resolve(ctx.idx.currencies.find(curRaw), curRaw, "currency", "العملة");
  const email = v(r, "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`البريد «${email}» غير صحيح`);
  const party = await createParty(tx, {
    nameAr,
    nameEn: v(r, "nameEn") || null,
    kind: /فرد|individual|شخص/.test(normText(v(r, "kind"))) ? "individual" : "company",
    vatNumber: vatNumber || null,
    crNumber: v(r, "crNumber") || null,
    address: { city: v(r, "city"), district: v(r, "district"), street: v(r, "street"), buildingNo: v(r, "buildingNo"), postalCode: v(r, "postalCode"), additionalNo: v(r, "additionalNo") },
    mobile: v(r, "mobile") || null,
    email: email || null,
    country,
    defaultCurrency,
    roles: ["customer"],
  });
  ctx.idx.parties.add([nameAr], party.id);
  ctx.idx.customers.add([nameAr, v(r, "nameEn")], party.id);
  return nameAr;
}

// ───────────── سندات القبض ─────────────

const METHODS: [RegExp, "cash" | "transfer" | "cheque" | "card"][] = [
  [/^(نقد|نقدي|نقدا|كاش|cash)$/, "cash"],
  [/^(تحويل|تحويل بنكي|حواله|bank transfer|transfer)$/, "transfer"],
  [/^(شيك|cheque|check)$/, "cheque"],
  [/^(بطاقه|شبكه|مدي|card|pos)$/, "card"],
];

async function importReceipt(tx: Tx, [r]: ImportRow[], ctx: Ctx, userId?: number) {
  const custRaw = required(r, "customer", "العميل");
  const customerId = resolve(ctx.idx.customers.find(custRaw), custRaw, "customer", "العميل");
  const receiptDate = toDate(required(r, "receiptDate", "التاريخ"), "التاريخ");
  const amount = toNumber(required(r, "amount", "المبلغ"), "المبلغ", { positive: true });
  const cashRaw = required(r, "cashAccount", "تم الدفع من خلال");
  const cash = findAccount(ctx, cashRaw, "تم الدفع من خلال");
  if (!/^110[125]/.test(cash.code)) throw new Error(`الحساب ${cash.code} ${cash.nameAr} ليس صندوقاً أو بنكاً أو عهدة موظف`);
  const curRaw = v(r, "currency") || "SAR";
  const currencyCode = resolve(ctx.idx.currencies.find(curRaw), curRaw, "currency", "العملة");
  const kindRaw = normText(v(r, "kind"));
  const kind = /مقدم|advance|prepayment/.test(kindRaw) ? "advance" : "invoice_payment";
  const methodRaw = normText(v(r, "method"));
  const method = methodRaw ? METHODS.find(([re]) => re.test(methodRaw))?.[1] : "transfer";
  if (!method) throw new Error(`طريقة الدفع «${v(r, "method")}»: نقد أو تحويل أو شيك أو بطاقة`);
  const reference = v(r, "reference");
  if (reference) {
    const [dup] = await tx.select({ number: s.receipts.number }).from(s.receipts).where(eq(s.receipts.reference, reference)).limit(1);
    if (dup) throw new Error(`المرجع ${reference} مستورد مسبقاً (${dup.number})`);
  }
  let invoiceId: number | null = null;
  const invRaw = v(r, "invoice");
  if (invRaw) {
    if (kind === "advance") throw new Error("الدفعة المقدمة لا تُربط بفاتورة؛ احذف رقم الفاتورة أو غيّر النوع");
    const [inv] = await tx
      .select({ id: s.salesInvoices.id, customerId: s.salesInvoices.customerId, status: s.salesInvoices.status })
      .from(s.salesInvoices)
      .where(or(eq(s.salesInvoices.number, invRaw), eq(s.salesInvoices.reference, invRaw)));
    if (!inv || inv.status !== "issued") throw new MissingRef({ kind: "invoice", value: invRaw }, `الفاتورة «${invRaw}» غير موجودة أو لم تُصدر`);
    if (inv.customerId !== customerId) throw new Error(`الفاتورة «${invRaw}» لعميل آخر`);
    invoiceId = inv.id;
  }
  const receipt = await createReceipt(tx, {
    kind,
    receiptDate,
    customerId,
    amount,
    currencyCode,
    method,
    cashAccountId: cash.id,
    invoiceId,
    reference: reference || null,
    notes: v(r, "notes") || null,
    post: ctx.post,
    userId,
  });
  return receipt.number;
}

// ───────────── القيود اليومية ─────────────

async function importJournal(tx: Tx, rows: ImportRow[], ctx: Ctx, userId?: number) {
  const [first] = rows;
  const reference = required(first, "reference", "رقم القيد");
  const entryDate = toDate(required(first, "entryDate", "التاريخ"), "التاريخ");
  for (const r of rows.slice(1)) if (v(r, "entryDate") && toDate(v(r, "entryDate"), "التاريخ") !== entryDate) throw new Error(`سطور القيد ${reference} بتواريخ مختلفة`);
  const [dup] = await tx.select({ number: s.journalEntries.number }).from(s.journalEntries).where(eq(s.journalEntries.reference, reference)).limit(1);
  if (dup) throw new Error(`القيد ${reference} مستورد مسبقاً (${dup.number})`);
  const lines = rows.map((r) => {
    const at = ` (الصف ${r.row})`;
    const accRaw = required(r, "account", `الحساب${at}`);
    const account = findAccount(ctx, accRaw, `الحساب${at}`);
    const debit = v(r, "debit") ? toNumber(v(r, "debit"), `مدين${at}`, { min: 0 }) : 0;
    const credit = v(r, "credit") ? toNumber(v(r, "credit"), `دائن${at}`, { min: 0 }) : 0;
    const ccRaw = v(r, "costCenter");
    const partyRaw = v(r, "party");
    return {
      accountId: account.id,
      description: v(r, "lineDescription") || null,
      debit,
      credit,
      costCenterId: ccRaw ? resolve(ctx.idx.costCenters.find(ccRaw), ccRaw, "costCenter", `مركز التكلفة${at}`) : null,
      partyId: partyRaw ? resolve(ctx.idx.parties.find(partyRaw), partyRaw, "customer", `الجهة${at}`) : null,
    };
  });
  const description = rows.map((r) => v(r, "description")).find(Boolean) || `قيد مستورد ${reference}`;
  const entry = await createManualEntry(tx, { entryDate, description, reference, lines, post: ctx.post, userId });
  return entry.number;
}

// ───────────── المخالفات المرورية ─────────────

async function importViolation(tx: Tx, [r]: ImportRow[], ctx: Ctx, userId?: number) {
  const violationDate = toDate(required(r, "violationDate", "تاريخ المخالفة"), "تاريخ المخالفة");
  const plate = required(r, "vehicle", "المركبة");
  const vehicleId = resolve(ctx.idx.vehicles.find(plate), plate, "costCenter", "المركبة");
  const charge = normText(required(r, "chargeTo", "على من"));
  const chargeTo = /سائق|driver/.test(charge) ? "driver" : /شركه|company|منشاه/.test(charge) ? "company" : null;
  if (!chargeTo) throw new Error(`على من «${v(r, "chargeTo")}»: اكتب السائق أو الشركة`);
  const violation = await createViolation(tx, {
    violationDate,
    vehicleId,
    reference: v(r, "reference") || null,
    violationType: required(r, "violationType", "نوع المخالفة"),
    location: v(r, "location") || null,
    amount: toNumber(required(r, "amount", "المبلغ"), "المبلغ", { positive: true }),
    chargeTo,
    notes: v(r, "notes") || null,
    userId,
  });
  return violation.number;
}

async function importProduct(tx: Tx, [r]: ImportRow[], _ctx: Ctx, userId?: number) {
  const kind = /خدم|service/.test(normText(v(r, "kind"))) ? "service" : "stock";
  const num = (key: string, label: string) => (v(r, key) ? toNumber(v(r, key), label, { min: 0 }) : 0);
  const product = await createProduct(tx, {
    code: v(r, "code") || null,
    nameAr: required(r, "nameAr", "اسم الصنف"),
    kind,
    category: v(r, "category") || null,
    unit: v(r, "unit") || null,
    barcode: v(r, "barcode") || null,
    purchasePrice: num("purchasePrice", "سعر الشراء"),
    salePrice: num("salePrice", "سعر البيع"),
    reorderLevel: num("reorderLevel", "حد إعادة الطلب"),
  });
  const qty = num("openingQty", "الرصيد الافتتاحي");
  if (qty > 0) {
    if (kind !== "stock") throw new Error("الخدمة بلا رصيد مخزني");
    const whName = v(r, "warehouse");
    const whs = await tx.select().from(s.warehouses);
    const wh = whName ? whs.find((w) => normText(w.nameAr) === normText(whName) || w.code === whName) : whs[0];
    if (!wh) throw new Error(`المستودع «${whName}» غير موجود`);
    if (!(Number(product.purchasePrice) > 0)) throw new Error("اكتب سعر الشراء لتقييم الرصيد الافتتاحي");
    await openingStockTx(tx, { productId: product.id, warehouseId: wh.id, quantity: qty, unitCost: Number(product.purchasePrice), date: todayRiyadh(), userId });
  }
  return product.code;
}

/** الأصل الثابت (ملاحظة التشغيل 9): الإهلاك على مركز المركبة أو المركز المكتوب، ولا يُستورد مرتين (الاسم وتاريخ الاقتناء). */
async function importFixedAsset(tx: Tx, [r]: ImportRow[], ctx: Ctx, userId?: number) {
  const nameAr = required(r, "nameAr", "اسم الأصل");
  const category = required(r, "category", "الفئة");
  const asset = findAccount(ctx, category, "الفئة");
  if (!asset.code.startsWith("12") || asset.code.startsWith("1202")) throw new Error(`الفئة «${category}» ليست حساب أصل ثابت (1201…)`);
  const plate = v(r, "vehicle");
  const vehicleId = plate ? resolve(ctx.idx.vehicles.find(plate), plate, "costCenter", "المركبة") : null;
  const ccRaw = v(r, "costCenter");
  if (plate && ccRaw) throw new Error("اكتب المركبة أو مركز التكلفة، لا الاثنين: المركبة تحدد مركزها");
  const costCenterId = ccRaw ? resolve(ctx.idx.costCenters.find(ccRaw), ccRaw, "costCenter", "مركز التكلفة") : null;
  const acquisitionDate = toDate(required(r, "acquisitionDate", "تاريخ الاقتناء"), "تاريخ الاقتناء");
  const [dup] = await tx
    .select({ number: s.fixedAssets.number })
    .from(s.fixedAssets)
    .where(and(eq(s.fixedAssets.nameAr, nameAr), eq(s.fixedAssets.acquisitionDate, acquisitionDate)));
  if (dup) throw new Error(`الأصل «${nameAr}» بتاريخ الاقتناء نفسه مسجل مسبقاً برقم ${dup.number}`);
  const num = (key: string, label: string) => (v(r, key) ? toNumber(v(r, key), label, { min: 0 }) : 0);
  const offset = v(r, "offsetAccount");
  const row = await createAsset(tx, {
    nameAr,
    assetAccountId: asset.id,
    vehicleId,
    costCenterId,
    acquisitionDate,
    depreciationStart: v(r, "depreciationStart") ? toDate(v(r, "depreciationStart"), "بداية الإهلاك") : null,
    cost: toNumber(required(r, "cost", "التكلفة"), "التكلفة", { positive: true }),
    salvageValue: num("salvageValue", "قيمة الخردة"),
    usefulLifeMonths: Math.round(toNumber(required(r, "lifeYears", "العمر الإنتاجي"), "العمر الإنتاجي", { positive: true }) * 12),
    openingDepreciation: num("openingDepreciation", "إهلاك سابق"),
    offsetAccountId: offset ? findAccount(ctx, offset, "قيد الاقتناء مقابل").id : null,
    notes: v(r, "notes") || null,
    userId,
  });
  return row.number;
}

/** نوع الصيانة بالاسم العربي (أو جزء منه) أو بالمفتاح. */
function maintenanceType(raw: string): MaintenanceType {
  const t = normText(raw);
  if (!t) return "mechanical";
  for (const [k, label] of Object.entries(MAINTENANCE_TYPES)) if (k === raw.trim() || normText(label).includes(t) || t.includes(normText(label.split(" ")[0]))) return k as MaintenanceType;
  if (/اطار|بنشر|tire/.test(t)) return "tires";
  if (/زيت|فلتر/.test(t)) return "consumable";
  throw new Error(`نوع الصيانة «${raw}» غير معروف`);
}

async function importMaintenanceOrder(tx: Tx, rows: ImportRow[], ctx: Ctx, userId?: number) {
  const [r] = rows;
  const plate = required(r, "vehicle", "المركبة");
  const vehicleId = resolve(ctx.idx.vehicles.find(plate), plate, "costCenter", "المركبة");
  const workshop = v(r, "workshop");
  const found = workshop ? ctx.idx.parties.find(workshop) : undefined;
  if (workshop && found == null) throw new Error(found === null ? `الورشة «${workshop}» تطابق أكثر من جهة` : `الورشة «${workshop}» غير موجودة؛ أضفها من شاشة الموردين أولاً`);
  const supplierId = found ?? null;
  const cashRaw = v(r, "cashAccount");
  const cash = cashRaw ? findAccount(ctx, cashRaw, "الصندوق") : null;
  const odometer = v(r, "odometer") ? toNumber(v(r, "odometer"), "قراءة العداد", { min: 0 }) : null;
  const order = await createMaintenanceOrder(tx, {
    vehicleId,
    orderDate: toDate(required(r, "orderDate", "التاريخ"), "التاريخ"),
    type: maintenanceType(v(r, "type")),
    provider: supplierId ? "external" : "internal",
    supplierId,
    supplierInvoiceNo: v(r, "supplierInvoiceNo") || null,
    cashAccountId: cash?.id ?? null,
    odometer: odometer != null ? Math.round(odometer) : null,
    notes: v(r, "notes") || null,
    userId,
  });
  await addMaintenanceLines(
    tx,
    order.id,
    rows.map((x) => {
      const vat = purchaseVat(ctx, v(x, "vat"));
      return {
        kind: /شغل|يد|labor|عمل/.test(normText(v(x, "lineKind"))) ? ("labor" as const) : ("part" as const),
        description: required(x, "description", "الوصف"),
        quantity: v(x, "quantity") ? toNumber(v(x, "quantity"), "الكمية", { positive: true }) : 1,
        unitPrice: toNumber(required(x, "unitPrice", "سعر الوحدة"), "سعر الوحدة", { min: 0 }),
        vatRate: vat,
      };
    }),
  );
  return order.number;
}

const badPriority = (raw: string): never => {
  throw new Error(`الأولوية «${raw}»: اكتب منخفضة أو عادية أو عاجلة`);
};

/** نسبة ضريبة المشتريات: فارغ = 15%، أو 15% / بدون، أو اسم ضريبة مشتريات كما في وافق. */
function purchaseVat(ctx: Ctx, raw: string) {
  const t = normText(raw);
  if (!t || /^(15|15 ?%|vat|خاضع)$/.test(t.replace(/\s/g, ""))) return 15;
  if (/^(0|بدون|صفر|معفي|معفاه|لا|no|none)$/.test(t)) return 0;
  const tax = ctx.purchaseTax.find(raw);
  if (tax) return Number(tax.rate);
  throw new Error(`الضريبة «${raw}» غير معروفة؛ اكتب 15% أو بدون، أو اسم ضريبة مشتريات كما في وافق`);
}

async function importBreakdown(tx: Tx, [r]: ImportRow[], ctx: Ctx, userId?: number) {
  const plate = required(r, "vehicle", "المركبة");
  const p = normText(v(r, "priority"));
  const req = await createBreakdownRequest(tx, {
    vehicleId: resolve(ctx.idx.vehicles.find(plate), plate, "costCenter", "المركبة"),
    reportDate: toDate(required(r, "reportDate", "التاريخ"), "التاريخ"),
    description: required(r, "description", "وصف العطل"),
    priority: /عاجل|urgent/.test(p) ? "urgent" : /منخفض|low/.test(p) ? "low" : !p || /عادي|normal/.test(p) ? "normal" : badPriority(v(r, "priority")),
    estimatedCost: v(r, "estimatedCost") ? toNumber(v(r, "estimatedCost"), "التكلفة التقديرية", { min: 0 }) : null,
    userId,
  });
  return req.number;
}

async function importPlan(tx: Tx, [r]: ImportRow[], ctx: Ctx) {
  const plate = required(r, "vehicle", "المركبة");
  const plan = await savePlan(tx, {
    vehicleId: resolve(ctx.idx.vehicles.find(plate), plate, "costCenter", "المركبة"),
    type: maintenanceType(v(r, "type")),
    title: required(r, "title", "اسم الصيانة"),
    intervalDays: Math.round(toNumber(required(r, "intervalDays", "كل (يوم)"), "كل (يوم)", { positive: true })),
    lastDoneDate: v(r, "lastDone") ? toDate(v(r, "lastDone"), "آخر تنفيذ") : null,
  });
  return `${plate}: ${plan.title}`;
}

const IMPORTERS: Record<string, (tx: Tx, rows: ImportRow[], ctx: Ctx, userId?: number) => Promise<string>> = {
  "sales-invoices": importInvoice,
  quotations: importQuotation,
  waybills: importWaybill,
  vehicles: importVehicle,
  customers: importCustomer,
  receipts: importReceipt,
  "journal-entries": importJournal,
  violations: importViolation,
  products: importProduct,
  "fixed-assets": importFixedAsset,
  "maintenance-orders": importMaintenanceOrder,
  "breakdown-requests": importBreakdown,
  "maintenance-plans": importPlan,
};

/** يجمع الصفوف في سجلات: بنود الفاتورة الواحدة معاً (ولو تباعدت في الملف)، وغيرها صف لكل سجل. */
function groupRows(spec: ImportSpec, rows: ImportRow[]) {
  if (!spec.groupBy) return rows.map((r) => [r]);
  const groups = new Map<string, ImportRow[]>();
  const loose: ImportRow[][] = [];
  for (const r of rows) {
    const key = normText(v(r, spec.groupBy));
    if (!key) loose.push([r]);
    else groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values(), ...loose];
}

const DATE_KEYS = new Set(["invoiceDate", "dueDate", "date", "validUntil", "receiptDate", "entryDate", "violationDate", "orderDate", "reportDate", "lastDone", "acquisitionDate", "depreciationStart"]);
const NUMBER_KEYS = new Set(["quantity", "unitPrice", "discount", "amount", "carrierCost", "comp1Qty", "comp1Price", "comp2Qty", "comp2Price", "comp3Qty", "comp3Price", "commission", "tripCustody", "charge1Amount", "charge2Amount", "charge3Amount", "weight", "year", "odometer", "debit", "credit", "purchasePrice", "salePrice", "reorderLevel", "openingQty", "estimatedCost", "intervalDays", "cost", "salvageValue", "lifeYears", "openingDepreciation"]);

/**
 * فحص أولي لكل خانات السجل قبل حفظه، فتظهر كل أخطاء الصف معاً (لا الأول فقط) كما في وافق:
 * المطلوب الفارغ، والرقم أو التاريخ غير الصحيح. في السجل متعدد السطور تُفحص البيانات الرئيسية في سطره الأول.
 */
function precheck(spec: ImportSpec, group: ImportRow[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  group.forEach((r, i) => {
    for (const f of spec.fields) {
      const raw = v(r, f.key);
      let message = "";
      if (!raw) {
        if (f.required && (i === 0 || !spec.groupBy) && !(f.requiredUnless && v(r, f.requiredUnless))) message = `${f.label} مطلوب`;
      } else {
        try {
          if (DATE_KEYS.has(f.key)) toDate(raw, f.label);
          else if (NUMBER_KEYS.has(f.key)) toNumber(raw, f.label);
        } catch (err) {
          message = errorMessage(err);
        }
      }
      if (message) issues.push({ rows: [r.row], message, field: f.key });
    }
  });
  return issues;
}

/** العمود المقصود في رسالة الخطأ (أطول اسم حقل يرد فيها)، ليُعرض بجانب رقم الصف كما في وافق. */
export function fieldOf(spec: ImportSpec, message: string) {
  const m = ` ${normText(message)} `;
  let best: { key: string; len: number } | undefined;
  for (const f of spec.fields) {
    for (const name of [f.label, ...(f.aliases ?? [])]) {
      const n = normText(name);
      if (n.length >= 3 && m.includes(` ${n} `) && (!best || n.length > best.len)) best = { key: f.key, len: n.length };
    }
  }
  return best?.key;
}

export async function runImport(db: Db, spec: ImportSpec, rows: ImportRow[], opts: { dryRun: boolean; userId?: number; post?: boolean }): Promise<ImportReport> {
  const importer = IMPORTERS[spec.entity];
  if (!importer) return { dryRun: opts.dryRun, total: 0, ok: 0, issues: [], error: "هذا البند لا يدعم الاستيراد" };
  if (rows.length > 5000) return { dryRun: opts.dryRun, total: 0, ok: 0, issues: [], error: "الملف أكبر من المسموح (5000 صف)؛ قسّمه على أكثر من ملف" };
  const groups = groupRows(spec, rows);
  const report: ImportReport = { dryRun: opts.dryRun, total: groups.length, ok: 0, issues: [], created: [] };
  try {
    await db.transaction(async (tx) => {
      const ctx: Ctx = { ...(await lookups(tx)), post: opts.post };
      for (const group of groups) {
        const pre = precheck(spec, group);
        if (pre.length) {
          report.issues.push(...pre);
          continue;
        }
        try {
          const label = await tx.transaction((sp) => importer(sp, group, ctx, opts.userId));
          report.ok++;
          report.created!.push(label);
        } catch (err) {
          const message = errorMessage(err);
          report.issues.push({
            rows: group.map((r) => r.row),
            message,
            field: fieldOf(spec, message),
            missing: err instanceof MissingRef ? err.missing : undefined,
          });
        }
      }
      if (opts.dryRun) throw DRY_RUN;
    });
  } catch (err) {
    if (err !== DRY_RUN) return { ...report, ok: 0, created: [], error: errorMessage(err) };
  }
  return report;
}

/** القوائم المرفقة بالقالب: القيم المعرفة في النظام لكل عمود يجب أن يطابقها. */
export async function templateLists(db: Db, spec: ImportSpec): Promise<TemplateList[]> {
  const ctx = await db.transaction((tx) => lookups(tx));
  const accountsOf = (type: string) => ctx.accounts.filter((a) => a.type === type).sort((a, b) => a.code.localeCompare(b.code));
  const currencies = { title: "العملات", values: ctx.currencies.map((c) => c.code) };
  // قوائم مصاريف العميل (النوع، الدافع، الحساب أو المخلص) لقالبي الشحنات والفواتير
  const chargeLists = async (): Promise<TemplateList[]> => {
    const [types, brokers] = await Promise.all([
      db.select({ n: s.chargeTypes.nameAr }).from(s.chargeTypes).where(eq(s.chargeTypes.isActive, true)),
      db.select({ n: s.parties.nameAr }).from(s.parties).innerJoin(s.partyRoles, and(eq(s.partyRoles.partyId, s.parties.id), eq(s.partyRoles.role, "customs_broker"))),
    ]);
    const pay = ctx.accounts.filter((a) => /^[12]/.test(a.code) && a.code !== "1114").sort((a, b) => a.code.localeCompare(b.code));
    return [
      { title: "أنواع مصاريف العميل", values: types.map((x) => x.n), field: ["charge1", "charge2", "charge3"] },
      { title: "دافع المصروف", values: ["الشركة", "المخلص"], field: ["charge1Payer", "charge2Payer", "charge3Payer"] },
      { title: "حسابات الدفع (الرقم)", values: pay.map((a) => a.code), field: ["charge1From", "charge2From", "charge3From"] },
      { title: "اسم حساب الدفع", values: pay.map((a) => a.nameAr) },
      { title: "المخلصون", values: brokers.map((x) => x.n).sort((a, b) => a.localeCompare(b, "ar")) },
    ];
  };
  if (spec.entity === "sales-invoices") {
    const revenue = accountsOf("revenue");
    return [
      { title: "العملاء", values: ctx.customers.map((c) => c.nameAr).sort(), field: "customer" },
      { title: "حسابات الإيراد (الرقم)", values: revenue.map((a) => a.code), field: "account" },
      { title: "اسم الحساب", values: revenue.map((a) => a.nameAr) },
      { ...currencies, field: "currency" },
      { title: "أنواع الضريبة (كما في وافق)", values: ctx.outTax.map((t) => t.nameAr), field: "taxCode" },
      { title: "المركبات (اللوحة)", values: ctx.vehicles.map((x) => x.plate).sort(), field: "costCenter" },
      { title: "مراكز التكلفة (الرمز)", values: ctx.costCenters.map((c) => c.code) },
      { title: "شامل/خالٍ من الضريبة", values: ["خالٍ من الضريبة", "شامل الضريبة"], field: "taxInclusive" },
      ...(await chargeLists()),
    ];
  }
  if (spec.entity === "quotations") {
    return [
      { title: "العملاء", values: ctx.customers.map((c) => c.nameAr).sort(), field: "customer" },
      { title: "نوع الشحن", values: ["دولي", "داخلي"], field: "shippingType" },
      { ...currencies, field: "currency" },
      { title: "أنواع الضريبة (كما في وافق)", values: ctx.outTax.map((t) => t.nameAr), field: "taxCode" },
    ];
  }
  if (spec.entity === "waybills") {
    const [cities, drivers, carriers] = await Promise.all([
      db.select({ n: s.locations.nameAr }).from(s.locations).where(eq(s.locations.isActive, true)),
      db.select({ n: s.employees.nameAr }).from(s.drivers).innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId)).where(eq(s.drivers.status, "active")),
      db.select({ n: s.parties.nameAr }).from(s.parties).innerJoin(s.partyRoles, and(eq(s.partyRoles.partyId, s.parties.id), eq(s.partyRoles.role, "carrier"))),
    ]);
    const sorted = (xs: { n: string }[]) => [...new Set(xs.map((x) => x.n))].sort((a, b) => a.localeCompare(b, "ar"));
    return [
      { title: "العملاء", values: ctx.customers.map((c) => c.nameAr).sort(), field: "customer" },
      { title: "مدن التحميل", values: sorted(cities), field: "from" },
      { title: "مدن التسليم", values: sorted(cities), field: "to" },
      { title: "المركبات", values: ctx.vehicles.map((x) => x.plate).sort(), field: ["vehicle", "trailer"] },
      { title: "السائقون", values: sorted(drivers), field: "driver" },
      { title: "الناقلون", values: sorted(carriers), field: "carrier" },
      { title: "مكونات السعر", values: (await customListOptions(db, "price_component")).map((o) => o.label), field: ["comp1", "comp2", "comp3"] },
      { title: "أنواع الضريبة (كما في وافق)", values: ctx.outTax.map((t) => t.nameAr), field: "taxCode" },
      ...(await chargeLists()),
    ];
  }
  if (spec.entity === "vehicles") {
    const assets = accountsOf("asset").filter((a) => a.code.startsWith("1201"));
    return [
      { title: "حسابات الأصول (الرقم)", values: assets.map((a) => a.code), field: "assetAccount" },
      { title: "اسم الحساب", values: assets.map((a) => a.nameAr) },
      { title: "فئات المركبات", values: ctx.vehicleTypes.map((t) => t.nameAr).sort(), field: "vehicleType" },
      { title: "الملكية", values: ["مملوكة", "مستأجرة"], field: "ownership" },
    ];
  }
  if (spec.entity === "receipts") {
    const cash = ctx.accounts.filter((a) => /^110[125]/.test(a.code)).sort((a, b) => a.code.localeCompare(b.code));
    return [
      { title: "العملاء", values: ctx.customers.map((c) => c.nameAr).sort(), field: "customer" },
      { title: "الصناديق والبنوك والعهد (الرقم)", values: cash.map((a) => a.code), field: "cashAccount" },
      { title: "اسم الحساب", values: cash.map((a) => a.nameAr) },
      { ...currencies, field: "currency" },
      { title: "النوع", values: ["دفعة عن فواتير", "دفعة مقدمة"], field: "kind" },
      { title: "طريقة الدفع", values: ["نقد", "تحويل", "شيك", "بطاقة"], field: "method" },
    ];
  }
  if (spec.entity === "journal-entries") {
    const postable = [...ctx.accounts].sort((a, b) => a.code.localeCompare(b.code));
    return [
      { title: "الحسابات (الرقم)", values: postable.map((a) => a.code), field: "account" },
      { title: "اسم الحساب", values: postable.map((a) => a.nameAr) },
      { title: "المركبات (اللوحة)", values: ctx.vehicles.map((x) => x.plate).sort(), field: "costCenter" },
      { title: "مراكز التكلفة (الرمز)", values: ctx.costCenters.map((c) => c.code) },
    ];
  }
  if (spec.entity === "violations") {
    return [
      { title: "المركبات (اللوحة)", values: ctx.vehicles.map((x) => x.plate).sort(), field: "vehicle" },
      { title: "على من", values: ["السائق", "الشركة"], field: "chargeTo" },
    ];
  }
  if (spec.entity === "fixed-assets") {
    const assets = ctx.accounts.filter((a) => a.code.startsWith("12") && !a.code.startsWith("1202")).sort((a, b) => a.code.localeCompare(b.code));
    const offsets = ctx.accounts.filter((a) => /^(1101|1102|21|3104)/.test(a.code)).sort((a, b) => a.code.localeCompare(b.code));
    return [
      { title: "فئات الأصول (الرقم)", values: assets.map((a) => a.code), field: "category" },
      { title: "اسم الفئة", values: assets.map((a) => a.nameAr) },
      { title: "المركبات (اللوحة)", values: ctx.vehicles.map((x) => x.plate).sort(), field: "vehicle" },
      { title: "مراكز التكلفة", values: ctx.costCenters.filter((c) => c.type !== "vehicle" && c.isActive).map((c) => c.nameAr), field: "costCenter" },
      { title: "حسابات قيد الاقتناء (الرقم)", values: offsets.map((a) => a.code), field: "offsetAccount" },
      { title: "اسم الحساب", values: offsets.map((a) => a.nameAr) },
    ];
  }
  if (spec.entity === "products") {
    return [
      { title: "النوع", values: ["مخزني", "خدمة"], field: "kind" },
      { title: "المستودعات", values: (await db.select({ n: s.warehouses.nameAr }).from(s.warehouses)).map((w) => w.n), field: "warehouse" },
    ];
  }
  if (spec.entity === "maintenance-orders" || spec.entity === "breakdown-requests" || spec.entity === "maintenance-plans") {
    const lists: TemplateList[] = [{ title: "المركبات (اللوحة)", values: ctx.vehicles.map((x) => x.plate).sort(), field: "vehicle" }];
    if (spec.entity !== "breakdown-requests") lists.push({ title: "أنواع الصيانة", values: Object.values(MAINTENANCE_TYPES), field: "type" });
    if (spec.entity === "maintenance-orders") {
      const workshops = await db
        .select({ n: s.parties.nameAr })
        .from(s.parties)
        .innerJoin(s.partyRoles, and(eq(s.partyRoles.partyId, s.parties.id), or(eq(s.partyRoles.role, "workshop"), eq(s.partyRoles.role, "supplier"))));
      lists.push(
        { title: "الورش والموردون", values: [...new Set(workshops.map((w) => w.n))].sort(), field: "workshop" },
        { title: "الصناديق (الرقم)", values: ctx.accounts.filter((a) => /^1101/.test(a.code)).map((a) => a.code).sort(), field: "cashAccount" },
        { title: "نوع البند", values: ["قطعة غيار", "شغل يد"], field: "lineKind" },
        { title: "الضريبة", values: ["15%", "بدون", ...ctx.purchaseTaxNames], field: "vat" },
      );
    }
    if (spec.entity === "breakdown-requests") lists.push({ title: "الأولوية", values: ["منخفضة", "عادية", "عاجلة"], field: "priority" });
    return lists;
  }
  if (spec.entity === "customers") {
    return [
      { title: "النوع", values: ["منشأة", "فرد"], field: "kind" },
      { ...currencies, field: "currency" },
      { title: "الدول", values: ["SA", "KW", "AE", "BH", "QA", "OM", "JO", "EG"], field: "country" },
    ];
  }
  return [];
}
