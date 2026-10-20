import { and, eq, or } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import type { ImportSpec } from "@/data/import-specs";
import { createManualInvoiceTx } from "@/lib/invoices";
import { createVehicle } from "@/lib/fleet";
import { createParty } from "@/lib/operations";
import { createReceipt } from "@/lib/receipts";
import { createManualEntry } from "@/lib/journal";
import { createViolation } from "@/lib/violations";
import { lineVat, round2 } from "@/lib/invoice-posting";
import { errorMessage } from "@/lib/errors";
import { normText, type ImportIssue, type ImportReport } from "@/lib/import-match";
import type { TemplateList } from "@/lib/xlsx";

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

/** يقبل 2026-10-05 أو 05/10/2026 أو 5-10-2026. */
function toDate(raw: string, label: string) {
  const t = raw.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
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

async function lookups(tx: Tx) {
  const [accounts, customers, parties, currencies, taxCodes, costCenters, vehicles, vehicleTypes] = await Promise.all([
    tx.select().from(s.accounts).where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true))),
    tx.select({ id: s.parties.id, nameAr: s.parties.nameAr, nameEn: s.parties.nameEn }).from(s.parties).innerJoin(s.partyRoles, and(eq(s.partyRoles.partyId, s.parties.id), eq(s.partyRoles.role, "customer"))),
    tx.select({ id: s.parties.id, nameAr: s.parties.nameAr }).from(s.parties),
    tx.select().from(s.currencies),
    tx.select().from(s.taxCodes).where(eq(s.taxCodes.isActive, true)),
    tx.select().from(s.costCenters),
    tx.select({ id: s.vehicles.id, plate: s.vehicles.plate, chassis: s.vehicles.chassis, costCenterId: s.vehicles.costCenterId }).from(s.vehicles),
    tx.select().from(s.vehicleTypes),
  ]);
  const idx = {
    accounts: new Index<(typeof accounts)[number]>(),
    customers: new Index<number>(),
    parties: new Index<number>(),
    currencies: new Index<string>(),
    taxCodes: new Index<(typeof taxCodes)[number]>(),
    costCenters: new Index<number>(),
    plates: new Set(vehicles.map((x) => normText(x.plate))),
    chassis: new Set(vehicles.map((x) => normText(x.chassis))),
    vehicleTypes: new Index<number>(),
    vehicles: new Index<number>(),
  };
  for (const a of accounts) idx.accounts.add([a.code, a.nameAr, a.nameEn, `${a.code} ${a.nameAr}`], a);
  for (const c of customers) idx.customers.add([c.nameAr, c.nameEn], c.id);
  for (const p of parties) idx.parties.add([p.nameAr], p.id);
  for (const c of currencies) idx.currencies.add([c.code, c.nameAr], c.code);
  const outTax = taxCodes.filter((t) => t.kind !== "input");
  const byCode = (code: string) => outTax.find((t) => t.code === code);
  for (const t of outTax) idx.taxCodes.add([t.code, t.nameAr], t);
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
  return { idx, defaultTax: vat ?? null, accounts, customers, currencies, outTax, costCenters, vehicles, vehicleTypes };
}

type Ctx = Awaited<ReturnType<typeof lookups>> & { post?: boolean };

function resolve<T>(found: T | undefined | null, raw: string, kind: Missing["kind"], label: string): T {
  if (found === null) throw new Error(`${label} «${raw}» يطابق أكثر من سجل؛ استخدم الرقم أو الرمز`);
  if (found === undefined) throw new MissingRef({ kind, value: raw }, `${label} «${raw}» غير موجود في النظام`);
  return found;
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

  const lines = rows.map((r) => {
    const at = rows.length > 1 ? ` (الصف ${r.row})` : "";
    const description = required(r, "description", `وصف البند${at}`);
    const quantity = toNumber(required(r, "quantity", `الكمية${at}`), `الكمية${at}`, { positive: true });
    const unitPrice = toNumber(required(r, "unitPrice", `السعر${at}`), `السعر${at}`, { min: 0 });
    const discountPercent = v(r, "discount") ? toNumber(v(r, "discount"), `الخصم${at}`, { min: 0, max: 100 }) : 0;
    const accRaw = required(r, "account", `حساب البند${at}`);
    const account = resolve(ctx.idx.accounts.find(accRaw), accRaw, "account", `الحساب${at}`);
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
  if (!(lines.reduce((t, l) => t + l.amount + l.vatAmount, 0) > 0)) throw new Error(`إجمالي الفاتورة ${reference} صفر`);
  const inv = await createManualInvoiceTx(tx, { customerId, invoiceDate, dueDate, currencyCode, reference, notes: v(head, "notes") || null, userId, lines });
  return `${inv.number} ← ${reference}`;
}

// ───────────── المركبات ─────────────

async function importVehicle(tx: Tx, [r]: ImportRow[], ctx: Ctx) {
  const plate = required(r, "plate", "اللوحة");
  const chassis = required(r, "chassis", "رقم الشاسيه");
  if (ctx.idx.plates.has(normText(plate))) throw new Error(`اللوحة ${plate} مسجلة مسبقاً`);
  if (ctx.idx.chassis.has(normText(chassis))) throw new Error(`رقم الشاسيه ${chassis} مسجل مسبقاً`);
  const accRaw = required(r, "assetAccount", "حساب الأصل");
  const account = resolve(ctx.idx.accounts.find(accRaw), accRaw, "account", "حساب الأصل");
  if (account.type !== "asset") throw new Error(`الحساب ${account.code} ${account.nameAr} ليس حساب أصل`);
  const typeRaw = v(r, "vehicleType");
  const vehicleTypeId = typeRaw ? resolve(ctx.idx.vehicleTypes.find(typeRaw), typeRaw, "vehicleType", "نوع المركبة") : null;
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
  ctx.idx.plates.add(normText(plate));
  ctx.idx.chassis.add(normText(chassis));
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
  const cash = resolve(ctx.idx.accounts.find(cashRaw), cashRaw, "account", "الحساب");
  if (!/^110[12]/.test(cash.code)) throw new Error(`الحساب ${cash.code} ${cash.nameAr} ليس صندوقاً أو بنكاً`);
  const curRaw = v(r, "currency") || "SAR";
  const currencyCode = resolve(ctx.idx.currencies.find(curRaw), curRaw, "currency", "العملة");
  const kindRaw = normText(v(r, "kind"));
  const kind = /مقدم|advance|prepayment/.test(kindRaw) ? "advance" : "invoice_payment";
  const methodRaw = normText(v(r, "method"));
  const method = methodRaw ? METHODS.find(([re]) => re.test(methodRaw))?.[1] : "transfer";
  if (!method) throw new Error(`طريقة الدفع «${v(r, "method")}»: نقد أو تحويل أو شيك أو بطاقة`);
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
    reference: v(r, "reference") || null,
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
    const accRaw = required(r, "account", "الحساب");
    const account = resolve(ctx.idx.accounts.find(accRaw), accRaw, "account", "الحساب");
    const debit = v(r, "debit") ? toNumber(v(r, "debit"), "مدين", { min: 0 }) : 0;
    const credit = v(r, "credit") ? toNumber(v(r, "credit"), "دائن", { min: 0 }) : 0;
    const ccRaw = v(r, "costCenter");
    const partyRaw = v(r, "party");
    return {
      accountId: account.id,
      description: v(r, "lineDescription") || null,
      debit,
      credit,
      costCenterId: ccRaw ? resolve(ctx.idx.costCenters.find(ccRaw), ccRaw, "costCenter", "مركز التكلفة") : null,
      partyId: partyRaw ? resolve(ctx.idx.parties.find(partyRaw), partyRaw, "customer", "الجهة") : null,
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

const IMPORTERS: Record<string, (tx: Tx, rows: ImportRow[], ctx: Ctx, userId?: number) => Promise<string>> = {
  "sales-invoices": importInvoice,
  vehicles: importVehicle,
  customers: importCustomer,
  receipts: importReceipt,
  "journal-entries": importJournal,
  violations: importViolation,
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
        try {
          const label = await tx.transaction((sp) => importer(sp, group, ctx, opts.userId));
          report.ok++;
          report.created!.push(label);
        } catch (err) {
          report.issues.push({
            rows: group.map((r) => r.row),
            message: errorMessage(err),
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
  if (spec.entity === "sales-invoices") {
    const revenue = accountsOf("revenue");
    return [
      { title: "العملاء", values: ctx.customers.map((c) => c.nameAr).sort(), field: "customer" },
      { title: "حسابات الإيراد (الرقم)", values: revenue.map((a) => a.code), field: "account" },
      { title: "اسم الحساب", values: revenue.map((a) => a.nameAr) },
      { ...currencies, field: "currency" },
      { title: "معدلات الضريبة", values: ["15%", "صفر", "معفى"], field: "taxCode" },
      { title: "المركبات (اللوحة)", values: ctx.vehicles.map((x) => x.plate).sort(), field: "costCenter" },
      { title: "مراكز التكلفة (الرمز)", values: ctx.costCenters.map((c) => c.code) },
      { title: "شامل/خالٍ من الضريبة", values: ["خالٍ من الضريبة", "شامل الضريبة"], field: "taxInclusive" },
    ];
  }
  if (spec.entity === "vehicles") {
    const assets = accountsOf("asset").filter((a) => a.code.startsWith("1201"));
    return [
      { title: "حسابات الأصول (الرقم)", values: assets.map((a) => a.code), field: "assetAccount" },
      { title: "اسم الحساب", values: assets.map((a) => a.nameAr) },
      { title: "أنواع المركبات", values: ctx.vehicleTypes.map((t) => t.nameAr).sort(), field: "vehicleType" },
      { title: "الملكية", values: ["مملوكة", "مستأجرة"], field: "ownership" },
    ];
  }
  if (spec.entity === "receipts") {
    const cash = ctx.accounts.filter((a) => /^110[12]/.test(a.code)).sort((a, b) => a.code.localeCompare(b.code));
    return [
      { title: "العملاء", values: ctx.customers.map((c) => c.nameAr).sort(), field: "customer" },
      { title: "الصناديق والبنوك (الرقم)", values: cash.map((a) => a.code), field: "cashAccount" },
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
  if (spec.entity === "customers") {
    return [
      { title: "النوع", values: ["منشأة", "فرد"], field: "kind" },
      { ...currencies, field: "currency" },
      { title: "الدول", values: ["SA", "KW", "AE", "BH", "QA", "OM", "JO", "EG"], field: "country" },
    ];
  }
  return [];
}
