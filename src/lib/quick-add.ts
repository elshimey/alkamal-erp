import "server-only";
import { and, asc, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { can, type Entity, type PermissionSet } from "@/lib/permissions";
import {
  createContract,
  createLocation,
  createParty,
  createRoute,
  setContractStatus,
  type PartyRole,
} from "@/lib/operations";
import { createDriver, createVehicle } from "@/lib/fleet";
import { createProduct } from "@/lib/inventory";
import {
  countryOptions,
  locationOptions,
  vehicleTypeOptions,
  routeOptions,
} from "@/lib/lookups";
import { PARTY_ROLES, PRICING_METHODS } from "@/data/operations";
import { todayRiyadh } from "@/lib/dates";
import type { QuickForm, QuickKind, QuickOption } from "@/lib/quick-add-types";

// «الإضافة السريعة» من داخل المستندات: نافذة صغيرة تضيف مدينة أو مساراً أو مركبة أو جهة أو سائقاً أو صنفاً
// دون مغادرة الصفحة، ثم تختاره في الخانة مباشرة. كل نوع يستخدم دالة الإنشاء نفسها في صفحته.

type Values = Record<string, string>;

const txt = (v: string | undefined) => (v ?? "").trim() || null;
function num(v: string | undefined, label: string) {
  const t = (v ?? "")
    .replace(/[,\s]/g, "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`${label}: رقم غير صحيح`);
  return n;
}
function req(v: string | undefined, label: string) {
  const t = (v ?? "").trim();
  if (!t) throw new Error(`${label} إلزامي`);
  return t;
}
const yes = (v: string | undefined) => v === "1" || v === "on" || v === "true";

const PARTY_KINDS = [
  "customer",
  "supplier",
  "carrier",
  "workshop",
  "fuel_station",
  "customs_broker",
] as const;
const isPartyKind = (k: QuickKind): k is (typeof PARTY_KINDS)[number] =>
  (PARTY_KINDS as readonly string[]).includes(k);

export function quickPerm(kind: QuickKind): Entity {
  if (kind === "city" || kind === "route") return "routes";
  if (kind === "vehicle") return "vehicles";
  if (kind === "driver") return "drivers";
  if (kind === "product") return "inventory";
  return "parties";
}

const keepField = (what: string) => ({
  key: "keep",
  label: `احفظ ${what} في القائمة للاستخدام لاحقاً`,
  type: "check" as const,
  default: "1",
  hint: `إن لم تحفظه يبقى على هذا المستند فقط ولا يظهر في القوائم بعد ذلك.`,
});

export async function quickForm(
  kind: QuickKind,
  perms: PermissionSet,
): Promise<QuickForm> {
  if (kind === "city") {
    const countries = await countryOptions();
    const sa =
      countries.find((c) => c.label.includes("السعودية"))?.value ??
      countries[0]?.value;
    return {
      title: "إضافة مدينة أو موقع",
      primary: "nameAr",
      fields: [
        {
          key: "countryId",
          label: "الدولة",
          type: "select",
          required: true,
          options: countries,
          default: sa,
        },
        {
          key: "nameAr",
          label: "اسم المدينة",
          hint: "لدولة خارجية: اتركه فارغاً فتُسجَّل الوجهة باسم الدولة",
        },
        {
          key: "site",
          label: "موقع داخلها (اختياري)",
          hint: "ميناء، مصنع، منفذ…",
        },
        { key: "border", label: "منفذ حدودي", type: "check" },
        keepField("المدينة"),
      ],
    };
  }
  if (kind === "route") {
    const locations = await locationOptions();
    return {
      title: "إضافة مسار",
      primary: "from",
      fields: [
        {
          key: "from",
          label: "من",
          type: "select",
          required: true,
          options: locations,
          create: "city",
        },
        {
          key: "to",
          label: "إلى",
          type: "select",
          required: true,
          options: locations,
          create: "city",
        },
        { key: "distanceKm", label: "المسافة (كم)", type: "number" },
        { key: "driverCommission", label: "عمولة السائق", type: "number" },
        { key: "diesel", label: "الديزل التقديري (لتر)", type: "number" },
        keepField("المسار"),
      ],
      note: "الرحلة تصبح دولية تلقائياً إذا اختلفت دولة الانطلاق عن دولة الوصول.",
    };
  }
  if (kind === "vehicle") {
    const [types, accounts] = await Promise.all([
      vehicleTypeOptions(),
      db
        .select({
          id: s.accounts.id,
          code: s.accounts.code,
          nameAr: s.accounts.nameAr,
        })
        .from(s.accounts)
        .where(
          and(
            like(s.accounts.code, "1201%"),
            eq(s.accounts.isPostable, true),
            eq(s.accounts.isActive, true),
          ),
        )
        .orderBy(asc(s.accounts.code)),
    ]);
    return {
      title: "إضافة مركبة",
      primary: "plate",
      fields: [
        { key: "plate", label: "رقم اللوحة", required: true },
        { key: "chassis", label: "رقم الشاسيه", required: true, ltr: true },
        {
          key: "vehicleTypeId",
          label: "نوع المركبة",
          type: "select",
          options: types,
        },
        {
          key: "assetAccountId",
          label: "حساب الأصل",
          type: "select",
          required: true,
          options: accounts.map((a) => ({
            value: String(a.id),
            label: `${a.code} ${a.nameAr}`,
          })),
          default: accounts[0] ? String(accounts[0].id) : undefined,
        },
        { key: "make", label: "الشركة المصنعة" },
        { key: "model", label: "الطراز" },
        { key: "year", label: "سنة الصنع", type: "number" },
        { key: "color", label: "اللون" },
        {
          key: "ownership",
          label: "الملكية",
          type: "select",
          options: [
            { value: "owned", label: "مملوكة" },
            { value: "leased", label: "مستأجرة" },
          ],
          default: "owned",
        },
        { key: "odometer", label: "قراءة العداد (كم)", type: "number" },
      ],
      note: "يُنشأ لها مركز تكلفة تلقائياً.",
    };
  }
  if (kind === "driver") {
    return {
      title: "إضافة سائق",
      primary: "nameAr",
      fields: [
        { key: "nameAr", label: "الاسم", required: true },
        { key: "mobile", label: "الجوال", ltr: true },
        { key: "nationality", label: "الجنسية" },
        { key: "residencyNumber", label: "رقم الإقامة أو الهوية", ltr: true },
        { key: "licenseNumber", label: "رقم الرخصة", ltr: true },
        {
          key: "commissionClass",
          label: "فئة العمولة",
          type: "select",
          options: [
            { value: "domestic", label: "داخلي" },
            { value: "international", label: "دولي" },
          ],
          default: "domestic",
        },
        { key: "basicSalary", label: "الراتب الأساسي", type: "number" },
        {
          key: "hireDate",
          label: "تاريخ التعيين",
          type: "date",
          default: todayRiyadh(),
        },
      ],
      note: "يُنشأ له حساب عهدة وحساب رواتب مستحقة تلقائياً.",
    };
  }
  if (kind === "product") {
    return {
      title: "إضافة صنف",
      primary: "nameAr",
      fields: [
        { key: "nameAr", label: "اسم الصنف", required: true },
        {
          key: "code",
          label: "الرمز",
          ltr: true,
          hint: "يُولَّد تلقائياً إن تركته فارغاً",
        },
        {
          key: "kind",
          label: "النوع",
          type: "select",
          options: [
            { value: "stock", label: "صنف مخزني" },
            { value: "service", label: "خدمة" },
          ],
          default: "stock",
        },
        { key: "unit", label: "الوحدة", hint: "حبة، لتر، طقم…" },
        { key: "purchasePrice", label: "سعر الشراء", type: "number" },
        { key: "salePrice", label: "سعر البيع", type: "number" },
        { key: "category", label: "الفئة" },
      ],
    };
  }
  // جهة اتصال بدور محدد؛ العميل يمكن إنشاء عقد تسعيره معه
  const role = kind as PartyRole;
  const fields: QuickForm["fields"] = [
    { key: "nameAr", label: "الاسم", required: true },
    {
      key: "kind",
      label: "النوع",
      type: "select",
      options: [
        { value: "company", label: "منشأة" },
        { value: "individual", label: "فرد" },
      ],
      default: "company",
    },
    { key: "vatNumber", label: "الرقم الضريبي", ltr: true },
    { key: "crNumber", label: "السجل التجاري", ltr: true },
    { key: "mobile", label: "الجوال", ltr: true },
    { key: "email", label: "البريد الإلكتروني", ltr: true },
    { key: "city", label: "المدينة", section: "العنوان (للفاتورة الضريبية)" },
    { key: "district", label: "الحي" },
    { key: "street", label: "الشارع" },
    { key: "buildingNo", label: "رقم المبنى", ltr: true },
    { key: "postalCode", label: "الرمز البريدي", ltr: true },
    {
      key: "country",
      label: "الدولة (رمز من حرفين)",
      ltr: true,
      default: "SA",
    },
  ];
  if (role === "customer" && can(perms, "contracts", "create")) {
    const [routes, types] = await Promise.all([
      routeOptions(),
      vehicleTypeOptions(),
    ]);
    const today = todayRiyadh();
    fields.push(
      {
        key: "withContract",
        label: "إنشاء عقد تسعير لهذا العميل الآن",
        type: "check",
        section: "عقد التسعير",
        hint: "حتى تُسعَّر شحناته تلقائياً من العقد.",
      },
      {
        key: "fromDate",
        label: "بداية العقد",
        type: "date",
        default: `${today.slice(0, 8)}01`,
        showIf: "withContract",
        hint: "تُسعَّر من العقد الشحنات التي تاريخها داخل مدته",
      },
      {
        key: "toDate",
        label: "نهاية العقد",
        type: "date",
        default: `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`,
        showIf: "withContract",
      },
      {
        key: "method",
        label: "طريقة التسعير",
        type: "select",
        options: Object.entries(PRICING_METHODS).map(([value, label]) => ({
          value,
          label,
        })),
        default: "route_fixed",
        showIf: "withContract",
      },
      {
        key: "routeId",
        label: "المسار",
        type: "select",
        options: routes,
        create: "route",
        showIf: "withContract",
        hint: "للسعر الثابت ونقل السيارات؛ اختياري للكمية",
      },
      {
        key: "vehicleTypeId",
        label: "نوع المركبة",
        type: "select",
        options: types,
        showIf: "withContract",
        hint: "للتسعير بالكيلومتر",
      },
      {
        key: "price",
        label: "السعر",
        type: "number",
        showIf: "withContract",
        hint: "للمسار، أو لكل كم، أو لكل وحدة",
      },
      {
        key: "unit",
        label: "الوحدة (للتسعير بالكمية)",
        showIf: "withContract",
        hint: "طن، كرتون، رحلة…",
      },
      {
        key: "currency",
        label: "العملة",
        type: "select",
        options: [
          { value: "SAR", label: "SAR" },
          { value: "KWD", label: "KWD" },
        ],
        default: "SAR",
        showIf: "withContract",
      },
      {
        key: "paymentTermsDays",
        label: "أيام السداد",
        type: "number",
        default: "30",
        showIf: "withContract",
      },
    );
  }
  return { title: `إضافة ${PARTY_ROLES[role]}`, primary: "nameAr", fields };
}

/** ينشئ العنصر ويعيد خياره كما يظهر في القوائم. */
export async function quickCreate(
  kind: QuickKind,
  v: Values,
  perms: PermissionSet,
): Promise<{ option: QuickOption; message?: string }> {
  if (kind === "city") {
    const countryId = Number(req(v.countryId, "الدولة"));
    const [country] = await db
      .select()
      .from(s.locations)
      .where(and(eq(s.locations.id, countryId), eq(s.locations.level, "country")));
    if (!country) throw new Error("الدولة غير موجودة");
    // الوجهة الدولية بلا مدينة محددة تُسجَّل باسم الدولة نفسها (الكويت مثلاً)
    const name =
      txt(v.nameAr) ??
      (country.countryCode !== "SA" ? country.nameAr : req(v.nameAr, "اسم المدينة"));
    const keep = yes(v.keep);
    const [existing] = await db
      .select()
      .from(s.locations)
      .where(
        and(eq(s.locations.parentId, countryId), eq(s.locations.nameAr, name)),
      );
    let city =
      existing ??
      (await createLocation(db, {
        parentId: countryId,
        nameAr: name,
        isBorderCrossing: !txt(v.site) && yes(v.border),
      }));
    if (existing && keep && !existing.isActive)
      [city] = await db
        .update(s.locations)
        .set({ isActive: true })
        .where(eq(s.locations.id, existing.id))
        .returning();
    if (!existing && !keep)
      await db
        .update(s.locations)
        .set({ isActive: false })
        .where(eq(s.locations.id, city.id));
    let target = city;
    const site = txt(v.site);
    if (site) {
      target = await createLocation(db, {
        parentId: city.id,
        nameAr: site,
        isBorderCrossing: yes(v.border),
      });
      if (!keep)
        await db
          .update(s.locations)
          .set({ isActive: false })
          .where(eq(s.locations.id, target.id));
    }
    const label = site ? `${city.nameAr} / ${site}` : city.nameAr;
    return {
      option: { value: String(target.id), label },
      message: existing && !site ? "المدينة مسجلة مسبقاً واختيرت" : undefined,
    };
  }
  if (kind === "route") {
    const from = Number(req(v.from, "من"));
    const to = Number(req(v.to, "إلى"));
    const keep = yes(v.keep);
    const [existing] = await db
      .select()
      .from(s.routes)
      .where(
        and(eq(s.routes.fromLocationId, from), eq(s.routes.toLocationId, to)),
      );
    let route = existing;
    if (!route) {
      route = await createRoute(db, {
        fromLocationId: from,
        toLocationId: to,
        distanceKm: num(v.distanceKm, "المسافة"),
        driverCommission: num(v.driverCommission, "عمولة السائق") ?? 0,
        estimatedDieselLiters: num(v.diesel, "الديزل التقديري"),
      });
      if (!keep)
        await db
          .update(s.routes)
          .set({ isActive: false })
          .where(eq(s.routes.id, route.id));
    } else if (keep && !route.isActive)
      await db
        .update(s.routes)
        .set({ isActive: true })
        .where(eq(s.routes.id, route.id));
    const labels = new Map(
      (await locationOptions({ includeHidden: true })).map((l) => [
        l.value,
        l.label,
      ]),
    );
    const label = `${labels.get(String(from))} ← ${labels.get(String(to))}`;
    return {
      option: {
        value: String(route.id),
        label,
        fill: { description: `نقل ${label}` },
      },
      message: existing ? "المسار مسجل مسبقاً واختير" : undefined,
    };
  }
  if (kind === "vehicle") {
    const year = num(v.year, "سنة الصنع");
    if (year != null && (year < 1980 || year > 2100))
      throw new Error("سنة الصنع غير صالحة");
    const row = await createVehicle(db, {
      assetAccountId: Number(req(v.assetAccountId, "حساب الأصل")),
      plate: req(v.plate, "رقم اللوحة"),
      chassis: req(v.chassis, "رقم الشاسيه"),
      vehicleTypeId: v.vehicleTypeId ? Number(v.vehicleTypeId) : null,
      make: txt(v.make),
      model: txt(v.model),
      year,
      ownership: v.ownership === "leased" ? "leased" : "owned",
      odometer: num(v.odometer, "العداد") ?? 0,
    });
    if (txt(v.color))
      await db
        .update(s.vehicles)
        .set({ color: txt(v.color) })
        .where(eq(s.vehicles.id, row.id));
    return { option: { value: String(row.id), label: row.plate } };
  }
  if (kind === "driver") {
    const d = await createDriver(db, {
      nameAr: req(v.nameAr, "الاسم"),
      mobile: txt(v.mobile),
      nationality: txt(v.nationality),
      residencyNumber: txt(v.residencyNumber),
      licenseNumber: txt(v.licenseNumber),
      commissionClass:
        v.commissionClass === "international" ? "international" : "domestic",
      hireDate: txt(v.hireDate),
      basicSalary: num(v.basicSalary, "الراتب الأساسي") ?? 0,
    });
    return { option: { value: String(d.id), label: v.nameAr.trim() } };
  }
  if (kind === "product") {
    const p = await createProduct(db, {
      code: txt(v.code),
      nameAr: req(v.nameAr, "اسم الصنف"),
      nameEn: null,
      kind: v.kind === "service" ? "service" : "stock",
      category: txt(v.category),
      unit: txt(v.unit),
      barcode: null,
      purchasePrice: num(v.purchasePrice, "سعر الشراء") ?? 0,
      salePrice: num(v.salePrice, "سعر البيع") ?? 0,
      reorderLevel: 0,
      accountId: null,
      notes: null,
    });
    const price = Number(p.purchasePrice) || 0;
    return {
      option: {
        value: String(p.id),
        label: `${p.code ? `${p.code} – ` : ""}${p.nameAr}`,
        fill: { description: p.nameAr, price: price ? String(price) : "" },
      },
    };
  }
  if (!isPartyKind(kind)) throw new Error("نوع غير معروف");
  return quickParty(kind, v, perms);
}

async function quickParty(role: PartyRole, v: Values, perms: PermissionSet) {
  const name = req(v.nameAr, "الاسم");
  const country = (txt(v.country) ?? "SA").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country))
    throw new Error("الدولة رمز من حرفين مثل SA");
  // جهة بالاسم نفسه موجودة: يُضاف لها الدور بدل تكرارها
  const [existing] = await db
    .select()
    .from(s.parties)
    .where(eq(s.parties.nameAr, name));
  let partyId: number;
  let message: string | undefined;
  if (existing) {
    partyId = existing.id;
    const [has] = await db
      .select()
      .from(s.partyRoles)
      .where(
        and(eq(s.partyRoles.partyId, existing.id), eq(s.partyRoles.role, role)),
      );
    if (!has)
      await db.insert(s.partyRoles).values({ partyId: existing.id, role });
    message = has
      ? `«${name}» مسجل مسبقاً واختير`
      : `«${name}» مسجل مسبقاً، وأُضيف له دور ${PARTY_ROLES[role]}`;
  } else {
    const party = await createParty(db, {
      nameAr: name,
      kind: v.kind === "individual" ? "individual" : "company",
      vatNumber: txt(v.vatNumber),
      crNumber: txt(v.crNumber),
      mobile: txt(v.mobile),
      email: txt(v.email),
      country,
      address: {
        buildingNo: txt(v.buildingNo),
        street: txt(v.street),
        district: txt(v.district),
        city: txt(v.city),
        postalCode: txt(v.postalCode),
      },
      roles: [role],
    });
    partyId = party.id;
  }
  if (role === "customer" && yes(v.withContract))
    message = await quickContract(partyId, v, perms, message);
  return { option: { value: String(partyId), label: name }, message };
}

/** عقد التسعير مع العميل الجديد: عقد وبند سعر واحد، ويُفعَّل إن كان للمستخدم صلاحية الاعتماد. */
async function quickContract(
  customerId: number,
  v: Values,
  perms: PermissionSet,
  before?: string,
) {
  if (!can(perms, "contracts", "create"))
    throw new Error("ليست لديك صلاحية إنشاء العقود");
  const method = req(v.method, "طريقة التسعير") as keyof typeof PRICING_METHODS;
  if (!(method in PRICING_METHODS)) throw new Error("طريقة التسعير غير معروفة");
  const price = num(v.price, "السعر");
  if (!price || price <= 0) throw new Error("سعر العقد إلزامي");
  const needRoute = [
    "route_fixed",
    "specific_vehicle",
    "car_transport",
  ].includes(method);
  if (method === "specific_vehicle")
    throw new Error("التسعير لمركبة محددة يُضاف من صفحة العقد");
  if (needRoute && !v.routeId) throw new Error("اختر مسار العقد");
  if (method === "per_km_vehicle_type" && !v.vehicleTypeId)
    throw new Error("اختر نوع المركبة للتسعير بالكيلومتر");
  if (method === "per_quantity" && !txt(v.unit))
    throw new Error("اكتب وحدة التسعير بالكمية (طن، كرتون…)");
  const fromDate = req(v.fromDate, "بداية العقد");
  const year = fromDate.slice(0, 4);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int + 1` })
    .from(s.contracts)
    .where(like(s.contracts.number, `C-${year}-%`));
  const contract = await db.transaction(async (tx) => {
    const c = await createContract(tx, {
      customerId,
      number: `C-${year}-${String(n).padStart(4, "0")}`,
      fromDate,
      toDate: req(v.toDate, "نهاية العقد"),
      currencyCode: v.currency === "KWD" ? "KWD" : "SAR",
      paymentTermsDays: num(v.paymentTermsDays, "أيام السداد") ?? 30,
    });
    await tx.insert(s.contractRates).values({
      contractId: c.id,
      method,
      routeId: v.routeId ? Number(v.routeId) : null,
      vehicleTypeId:
        method === "per_km_vehicle_type" ? Number(v.vehicleTypeId) : null,
      price: String(price),
      unit: method === "per_quantity" ? txt(v.unit) : null,
    });
    return c;
  });
  const prefix = before ? `${before}. ` : "";
  if (!can(perms, "contracts", "approve"))
    return `${prefix}أُنشئ العقد ${contract.number} مسودة؛ يفعّله من له صلاحية اعتماد العقود`;
  try {
    await setContractStatus(db, contract.id, "active");
    return `${prefix}أُنشئ العقد ${contract.number} وأصبح سارياً`;
  } catch (err) {
    return `${prefix}أُنشئ العقد ${contract.number} مسودة: ${err instanceof Error ? err.message : ""}`;
  }
}
