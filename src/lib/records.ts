import "server-only";
import { and, asc, eq, inArray, like, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { db, type Tx } from "@/db";
import * as s from "@/db/schema";
import type { Entity } from "@/lib/permissions";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { normalizeIban } from "@/lib/banks";
import { PARTY_ROLES } from "@/data/operations";
import { deleteDriver, updateDriver } from "@/lib/fleet";
import { OWNER_KINDS } from "@/lib/documents";

// صفحة تعديل وحذف موحّدة للبيانات الأساسية: كل كيان يُعرَّف هنا بحقوله وقواعده،
// وصفحة /records/[kind]/[id] تعرض نموذج التعديل والحذف الآمن وسجل التعديلات.

export type Opt = { value: string; label: string };
export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "bool" | "textarea" | "multi" | "password";
  options?: Opt[] | (() => Promise<Opt[]>);
  /** قيمة الاختيار رقم (معرّف سجل) */
  numeric?: boolean;
  required?: boolean;
  ltr?: boolean;
  hint?: string;
  /** حقل لا يُحفظ في الجدول مباشرة (يعالجه save) */
  virtual?: boolean;
}

type Row = Record<string, unknown>;
export interface RecordDef {
  /** اسم الكيان بالمفرد */
  noun: string;
  perm: Entity;
  listHref: string;
  listLabel: string;
  table: PgTable & { id: never };
  fields: FieldDef[];
  heading: (row: Row) => string | Promise<string>;
  /** قيم إضافية للنموذج (الأدوار مثلاً) */
  load?: (id: number) => Promise<Row>;
  /** مثل load لكل السجلات دفعة واحدة (للتعديل الجماعي) */
  loadAll?: () => Promise<Map<number, Row>>;
  /** تحقق وتعديلات بعد الحفظ في المعاملة نفسها */
  after?: (tx: Tx, id: number, values: Row, before: Row) => Promise<void>;
  /** حذف السجل وتوابعه؛ الافتراضي حذف الصف فقط */
  remove?: (tx: Tx, id: number, row: Row) => Promise<void>;
  /** رسالة تمنع الحذف قبل محاولته */
  guardDelete?: (row: Row) => string | null;
  /** ما يفعله المستخدم بدل الحذف إن كان للسجل حركات */
  instead: string;
  /** صفحة بديلة أغنى لهذا الكيان */
  redirect?: (id: number) => Promise<string | null>;
  /** حفظ وحذف بدالة الكيان نفسها بدل التعديل المباشر للجدول (السائق: موظفه وحساباته) */
  save?: (id: number, values: Row) => Promise<void>;
  del?: (id: number) => Promise<void>;
}

const yesNo = { type: "bool" as const };
const table = <T extends PgTable>(t: T) => t as unknown as PgTable & { id: never };

const STATUS_EMP: Opt[] = [
  { value: "active", label: "نشط" },
  { value: "on_leave", label: "إجازة" },
  { value: "terminated", label: "منتهية خدمته" },
];

/** بيانات موظف السائق (الاسم والهوية والتعيين والراتب) لسائق واحد أو للجميع. */
async function driverEmployees(id?: number) {
  const rows = await db
    .select({ id: s.drivers.id, nameAr: s.employees.nameAr, nationalId: s.employees.nationalId, hireDate: s.employees.hireDate, basicSalary: s.employees.basicSalary, birthDate: s.drivers.birthDate })
    .from(s.drivers)
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .where(id ? eq(s.drivers.id, id) : undefined);
  return new Map(rows.map(({ id, ...r }) => [id, r as Row]));
}

const currencies = async () => (await db.select().from(s.currencies).orderBy(asc(s.currencies.code))).map((c) => ({ value: c.code, label: `${c.code} ${c.nameAr}` }));

async function renameAccount(tx: Tx, id: number | null | undefined, nameAr: string) {
  if (id) await tx.update(s.accounts).set({ nameAr }).where(eq(s.accounts.id, id));
}
async function deleteAccounts(tx: Tx, ids: (number | null | undefined)[]) {
  const list = ids.filter((x): x is number => !!x);
  if (list.length) await tx.delete(s.accounts).where(inArray(s.accounts.id, list));
}

export const RECORDS: Record<string, RecordDef> = {
  vehicles: {
    noun: "المركبة",
    perm: "vehicles",
    listHref: "/vehicles",
    listLabel: "المركبات",
    table: table(s.vehicles),
    heading: (r) => `المركبة ${r.plate}`,
    fields: [
      { key: "plate", label: "اللوحة", required: true },
      { key: "chassis", label: "رقم الشاسيه", required: true, ltr: true },
      { key: "serialNumber", label: "الرقم التسلسلي", ltr: true },
      { key: "vehicleTypeId", label: "النوع", type: "select", numeric: true, options: async () => (await db.select().from(s.vehicleTypes).orderBy(asc(s.vehicleTypes.nameAr))).map((t) => ({ value: String(t.id), label: t.nameAr })) },
      {
        key: "assetAccountId",
        label: "حساب الأصل",
        type: "select",
        numeric: true,
        options: async () =>
          (await db.select().from(s.accounts).where(and(like(s.accounts.code, "1201%"), eq(s.accounts.isPostable, true))).orderBy(asc(s.accounts.code))).map((a) => ({ value: String(a.id), label: `${a.code} ${a.nameAr}` })),
      },
      { key: "make", label: "الماركة" },
      { key: "model", label: "الطراز" },
      { key: "year", label: "سنة الصنع", type: "number" },
      { key: "color", label: "اللون" },
      { key: "registrationType", label: "نوع التسجيل" },
      { key: "ownership", label: "الملكية", type: "select", options: [{ value: "owned", label: "مملوكة" }, { value: "leased", label: "مستأجرة" }] },
      { key: "ownershipDate", label: "تاريخ التملك", type: "date" },
      { key: "customsDocument", label: "البيان الجمركي" },
      { key: "odometer", label: "العداد (كم)", type: "number" },
      { key: "assetKind", label: "نوع الأصل", type: "select", required: true, options: [{ value: "head", label: "رأس (شاحنة)" }, { value: "trailer", label: "مقطورة (سطحة)" }], hint: "المقطورة تُختار في حقل «المقطورة» بالشحنة ولها وثائقها" },
      {
        key: "status",
        label: "الحالة",
        type: "select",
        options: [
          { value: "active", label: "تعمل" },
          { value: "maintenance", label: "في الصيانة" },
          { value: "stopped", label: "متوقفة" },
          { value: "sold", label: "مباعة" },
        ],
      },
    ],
    after: async (tx, id, v, before) => {
      if (v.assetKind !== before.assetKind) {
        const [doc] = await tx
          .select({ id: s.fleetDocuments.id })
          .from(s.fleetDocuments)
          .where(eq(s.fleetDocuments.vehicleId, id))
          .limit(1);
        if (doc) throw new Error("لها وثائق مسجلة بنوعها الحالي؛ احذفها أولاً ثم غيّر نوع الأصل");
      }
      if (v.plate !== before.plate) {
        await tx.update(s.costCenters).set({ code: `V-${v.plate}`, nameAr: `المركبة ${v.plate}` }).where(eq(s.costCenters.id, before.costCenterId as number));
      }
    },
    remove: async (tx, id, row) => {
      await tx.delete(s.vehicles).where(eq(s.vehicles.id, id));
      await tx.delete(s.costCenters).where(eq(s.costCenters.id, row.costCenterId as number));
    },
    instead: "غيّر حالتها إلى «مباعة» أو «متوقفة»",
  },

  parties: {
    noun: "جهة التعامل",
    perm: "parties",
    listHref: "/parties",
    listLabel: "العملاء والموردون",
    table: table(s.parties),
    heading: (r) => String(r.nameAr),
    fields: [
      { key: "nameAr", label: "الاسم", required: true },
      { key: "nameEn", label: "الاسم بالإنجليزية", ltr: true },
      { key: "kind", label: "النوع", type: "select", options: [{ value: "company", label: "منشأة" }, { value: "individual", label: "فرد" }] },
      { key: "roles", label: "الأدوار", type: "multi", virtual: true, options: Object.entries(PARTY_ROLES).map(([value, label]) => ({ value, label })) },
      { key: "vatNumber", label: "الرقم الضريبي", ltr: true },
      { key: "crNumber", label: "السجل التجاري", ltr: true },
      { key: "nationalAddress", label: "العنوان الوطني", type: "textarea" },
      { key: "buildingNo", label: "رقم المبنى (4 أرقام)", ltr: true },
      { key: "street", label: "الشارع" },
      { key: "district", label: "الحي" },
      { key: "city", label: "المدينة" },
      { key: "postalCode", label: "الرمز البريدي (5 أرقام)", ltr: true },
      { key: "additionalNo", label: "الرقم الإضافي", ltr: true },
      { key: "country", label: "الدولة (رمز من حرفين)", ltr: true, required: true },
      { key: "mobile", label: "الجوال", ltr: true },
      { key: "email", label: "البريد", ltr: true },
      { key: "defaultCurrency", label: "العملة الافتراضية", type: "select", options: currencies },
      { key: "isActive", label: "نشط", ...yesNo },
    ],
    load: async (id) => ({ roles: (await db.select({ role: s.partyRoles.role }).from(s.partyRoles).where(eq(s.partyRoles.partyId, id))).map((r) => r.role) }),
    loadAll: async () => {
      const m = new Map<number, Row>();
      for (const r of await db.select({ id: s.partyRoles.partyId, role: s.partyRoles.role }).from(s.partyRoles)) {
        const row = m.get(r.id) ?? { roles: [] as string[] };
        (row.roles as string[]).push(r.role);
        m.set(r.id, row);
      }
      return m;
    },
    after: async (tx, id, v) => {
      const roles = (v.roles as string[]).filter((r) => r in PARTY_ROLES) as (typeof s.partyRoleType.enumValues)[number][];
      if (!roles.length) throw new Error("اختر دوراً واحداً على الأقل");
      await tx.delete(s.partyRoles).where(eq(s.partyRoles.partyId, id));
      await tx.insert(s.partyRoles).values(roles.map((role) => ({ partyId: id, role })));
    },
    instead: "ألغِ علامة «نشط» فيختفي من القوائم مع بقاء حركاته",
  },

  locations: {
    noun: "الموقع",
    perm: "routes",
    listHref: "/routes",
    listLabel: "المواقع والمسارات",
    table: table(s.locations),
    heading: (r) => String(r.nameAr),
    fields: [
      { key: "nameAr", label: "الاسم", required: true },
      { key: "isBorderCrossing", label: "منفذ حدودي", ...yesNo },
      { key: "isActive", label: "يظهر في القوائم", ...yesNo },
    ],
    instead: "ألغِ علامة «يظهر في القوائم»",
  },

  routes: {
    noun: "المسار",
    perm: "routes",
    listHref: "/routes",
    listLabel: "المواقع والمسارات",
    table: table(s.routes),
    heading: async (r) => {
      const a = alias(s.locations, "a");
      const b = alias(s.locations, "b");
      const [x] = await db.select({ from: a.nameAr, to: b.nameAr }).from(a).innerJoin(b, eq(b.id, r.toLocationId as number)).where(eq(a.id, r.fromLocationId as number));
      return `المسار ${x?.from ?? ""} ← ${x?.to ?? ""}`;
    },
    fields: [
      { key: "distanceKm", label: "المسافة (كم)", type: "number" },
      { key: "driverCommission", label: "عمولة السائق", type: "number" },
      { key: "estimatedDieselLiters", label: "الديزل التقديري (لتر)", type: "number" },
      { key: "isInternational", label: "دولي", ...yesNo },
      { key: "isActive", label: "نشط", ...yesNo },
    ],
    instead: "ألغِ علامة «نشط»",
  },

  accounts: {
    noun: "الحساب",
    perm: "accounts",
    listHref: "/accounts",
    listLabel: "دليل الحسابات",
    table: table(s.accounts),
    heading: (r) => `${r.code} ${r.nameAr}`,
    fields: [
      { key: "nameAr", label: "اسم الحساب", required: true },
      { key: "nameEn", label: "الاسم بالإنجليزية", ltr: true },
      { key: "currencyCode", label: "عملة إلزامية", type: "select", options: currencies, hint: "فارغ = أي عملة" },
      { key: "requiresCostCenter", label: "يتطلب مركز تكلفة", ...yesNo },
      { key: "note", label: "ملاحظة", type: "textarea" },
      { key: "isActive", label: "نشط", ...yesNo },
    ],
    guardDelete: (r) => (r.isSystem ? "هذا حساب أساسي في النظام تعتمد عليه القيود التلقائية ولا يُحذف" : null),
    instead: "ألغِ علامة «نشط» فلا يظهر في الاختيار",
  },

  fleet_documents: {
    noun: "الوثيقة",
    perm: "fleet_documents",
    listHref: "/fleet-documents",
    listLabel: "سجل الوثائق",
    table: table(s.fleetDocuments),
    heading: async (r) => {
      const [t] = await db.select({ nameAr: s.documentTypes.nameAr }).from(s.documentTypes).where(eq(s.documentTypes.id, r.documentTypeId as number));
      return `${t?.nameAr ?? "وثيقة"} ${r.number ?? ""}`;
    },
    fields: [
      {
        key: "documentTypeId",
        label: "النوع",
        type: "select",
        numeric: true,
        required: true,
        hint: "يجب أن يناسب صاحب الوثيقة",
        options: async () => (await db.select().from(s.documentTypes).orderBy(asc(s.documentTypes.sortOrder))).map((t) => ({ value: String(t.id), label: `${t.nameAr} (${OWNER_KINDS[t.ownerKind].label})` })),
      },
      { key: "number", label: "الرقم", ltr: true },
      { key: "issueDate", label: "تاريخ الإصدار", type: "date" },
      { key: "expiryDate", label: "تاريخ الانتهاء", type: "date", hint: "فارغ = لا تنتهي" },
      { key: "authority", label: "جهة الإصدار" },
      { key: "cost", label: "التكلفة", type: "number" },
      { key: "notes", label: "ملاحظات", type: "textarea" },
    ],
    after: async (tx, id, v) => {
      const [row] = await tx
        .select({ kind: s.documentTypes.ownerKind, asset: s.vehicles.assetKind, doc: s.fleetDocuments })
        .from(s.fleetDocuments)
        .innerJoin(s.documentTypes, eq(s.documentTypes.id, s.fleetDocuments.documentTypeId))
        .leftJoin(s.vehicles, eq(s.vehicles.id, s.fleetDocuments.vehicleId))
        .where(eq(s.fleetDocuments.id, id));
      const d = row.doc;
      const owner = d.vehicleId ? (row.asset === "trailer" ? "trailer" : "vehicle") : d.driverId ? "driver" : d.employeeId ? "employee" : d.partyId ? "customer" : "company";
      if (row.kind !== owner) throw new Error(`هذا النوع وثيقة ${OWNER_KINDS[row.kind].label}، وصاحب الوثيقة ${OWNER_KINDS[owner].label}`);
      if (v.issueDate && v.expiryDate && String(v.issueDate) > String(v.expiryDate)) throw new Error("تاريخ الإصدار بعد تاريخ الانتهاء");
    },
    instead: "",
  },

  employees: {
    noun: "الموظف",
    perm: "employees",
    listHref: "/employees",
    listLabel: "الموظفون",
    table: table(s.employees),
    heading: (r) => String(r.nameAr),
    redirect: async (id) => {
      const [d] = await db.select({ id: s.drivers.id }).from(s.drivers).where(eq(s.drivers.employeeId, id));
      return d ? `/drivers/${d.id}` : null;
    },
    fields: [
      { key: "nameAr", label: "الاسم", required: true },
      { key: "jobTitle", label: "الوظيفة" },
      { key: "nationalId", label: "الهوية / الإقامة", ltr: true },
      { key: "hireDate", label: "تاريخ التعيين", type: "date" },
      { key: "basicSalary", label: "الراتب الأساسي", type: "number", required: true },
      { key: "housingAllowance", label: "بدل السكن", type: "number", required: true },
      { key: "allowances", label: "بدلات أخرى", type: "number", required: true },
      { key: "isSaudi", label: "سعودي", ...yesNo },
      { key: "gosiSubject", label: "مسجل بالتأمينات", ...yesNo },
      { key: "bankName", label: "البنك" },
      { key: "iban", label: "الآيبان", ltr: true },
      { key: "status", label: "الحالة", type: "select", options: STATUS_EMP },
    ],
    after: async (tx, id, v, before) => {
      if (v.iban) v.iban = normalizeIban(String(v.iban));
      if (v.status === "terminated" && before.status !== "terminated") {
        const [open] = await tx
          .select({ number: s.custodyDocs.number })
          .from(s.custodyDocs)
          .where(and(eq(s.custodyDocs.employeeId, id), sql`${s.custodyDocs.status} in ('approved','delivered')`))
          .limit(1);
        if (open) throw new Error(`على الموظف عهدة غير مسواة (${open.number})؛ سوّها قبل إنهاء خدمته`);
      }
      if (v.nameAr !== before.nameAr) {
        await renameAccount(tx, before.payableAccountId as number, `رواتب مستحقة – ${v.nameAr}`);
        await renameAccount(tx, before.custodyAccountId as number, `عهدة – ${v.nameAr}`);
      }
      if (v.iban !== before.iban) await tx.update(s.employees).set({ iban: (v.iban as string) || null }).where(eq(s.employees.id, id));
    },
    remove: async (tx, id, row) => {
      await tx.delete(s.employees).where(eq(s.employees.id, id));
      await deleteAccounts(tx, [row.payableAccountId as number, row.custodyAccountId as number]);
    },
    instead: "غيّر حالته إلى «منتهية خدمته»",
  },

  contracts: {
    noun: "العقد",
    perm: "contracts",
    listHref: "/contracts",
    listLabel: "العقود",
    table: table(s.contracts),
    heading: (r) => `العقد ${r.number}`,
    fields: [
      { key: "number", label: "رقم العقد", required: true, ltr: true },
      {
        key: "customerId",
        label: "العميل",
        type: "select",
        numeric: true,
        required: true,
        options: async () =>
          (await db.select({ id: s.parties.id, name: s.parties.nameAr }).from(s.parties).innerJoin(s.partyRoles, and(eq(s.partyRoles.partyId, s.parties.id), eq(s.partyRoles.role, "customer"))).orderBy(asc(s.parties.nameAr))).map((p) => ({ value: String(p.id), label: p.name })),
      },
      { key: "fromDate", label: "من تاريخ", type: "date", required: true },
      { key: "toDate", label: "إلى تاريخ", type: "date", required: true },
      { key: "currencyCode", label: "العملة", type: "select", options: currencies, required: true },
      { key: "creditLimit", label: "حد الائتمان", type: "number" },
      { key: "paymentTermsDays", label: "مدة السداد (يوم)", type: "number", required: true },
      { key: "notes", label: "ملاحظات", type: "textarea" },
    ],
    remove: async (tx, id) => {
      await tx.delete(s.contractRates).where(eq(s.contractRates.contractId, id));
      await tx.delete(s.contracts).where(eq(s.contracts.id, id));
    },
    instead: "أوقف العقد من صفحته",
  },

  drivers: {
    noun: "السائق",
    perm: "drivers",
    listHref: "/drivers",
    listLabel: "السائقون",
    table: table(s.drivers),
    heading: () => "السائق",
    redirect: async (id) => `/drivers/${id}`,
    fields: [
      { key: "nameAr", label: "الاسم", required: true, virtual: true },
      { key: "mobile", label: "الجوال", ltr: true },
      { key: "nationality", label: "الجنسية" },
      { key: "nationalId", label: "الهوية", ltr: true, virtual: true },
      { key: "residencyNumber", label: "رقم الإقامة", ltr: true },
      { key: "licenseNumber", label: "رقم الرخصة", ltr: true },
      { key: "transportCardNumber", label: "بطاقة النقل", ltr: true },
      { key: "commissionClass", label: "فئة العمولة", type: "select", options: [{ value: "domestic", label: "داخلي" }, { value: "international", label: "دولي" }] },
      { key: "appLanguage", label: "لغة التطبيق", type: "select", options: [{ value: "ar", label: "العربية" }, { value: "ur", label: "الأردية" }, { value: "hi", label: "الهندية" }, { value: "en", label: "الإنجليزية" }] },
      { key: "hireDate", label: "تاريخ التعيين", type: "date", virtual: true },
      { key: "basicSalary", label: "الراتب الأساسي", type: "number", virtual: true },
      { key: "custodyLimit", label: "سقف العهدة", type: "number" },
      { key: "status", label: "الحالة", type: "select", options: STATUS_EMP },
    ],
    load: async (id) => (await driverEmployees(id)).get(id) ?? {},
    loadAll: () => driverEmployees(),
    save: (id, v) =>
      updateDriver(db, id, {
        nameAr: String(v.nameAr ?? ""),
        mobile: (v.mobile as string) ?? null,
        nationality: (v.nationality as string) ?? null,
        nationalId: (v.nationalId as string) ?? null,
        residencyNumber: (v.residencyNumber as string) ?? null,
        licenseNumber: (v.licenseNumber as string) ?? null,
        transportCardNumber: (v.transportCardNumber as string) ?? null,
        birthDate: v.birthDate ? String(v.birthDate) : null,
        appLanguage: (v.appLanguage as "ar") ?? undefined,
        commissionClass: (v.commissionClass as "domestic") ?? undefined,
        hireDate: v.hireDate ? String(v.hireDate) : null,
        basicSalary: v.basicSalary != null ? Number(v.basicSalary) : undefined,
        custodyLimit: v.custodyLimit != null ? Number(v.custodyLimit) : null,
        status: (v.status as "active") ?? "active",
      }),
    del: async (id) => {
      await deleteDriver(db, id);
    },
    instead: "غيّر حالته إلى «منتهية خدمته»",
  },

  products: {
    noun: "الصنف",
    perm: "inventory",
    listHref: "/products",
    listLabel: "الأصناف والخدمات",
    table: table(s.products),
    heading: (r) => String(r.nameAr),
    redirect: async (id) => `/products?open=${id}`,
    fields: [
      { key: "code", label: "الرمز", required: true, ltr: true },
      { key: "nameAr", label: "الاسم", required: true },
      { key: "nameEn", label: "الاسم بالإنجليزية", ltr: true },
      { key: "kind", label: "النوع", type: "select", required: true, options: [{ value: "stock", label: "صنف مخزني" }, { value: "service", label: "خدمة" }] },
      { key: "category", label: "الفئة" },
      { key: "unit", label: "الوحدة" },
      { key: "barcode", label: "الباركود", ltr: true },
      { key: "purchasePrice", label: "سعر الشراء", type: "number", required: true },
      { key: "salePrice", label: "سعر البيع", type: "number", required: true },
      { key: "reorderLevel", label: "حد إعادة الطلب", type: "number", required: true },
      { key: "isActive", label: "نشط", ...yesNo },
    ],
    instead: "ألغِ علامة «نشط»",
  },

  bank_accounts: {
    noun: "الحساب البنكي",
    perm: "accounts",
    listHref: "/bank-accounts",
    listLabel: "البنوك والصناديق",
    table: table(s.bankAccounts),
    heading: (r) => String(r.bankName),
    fields: [
      { key: "accountName", label: "اسم الحساب في الدليل", required: true, virtual: true },
      { key: "bankName", label: "البنك", required: true },
      { key: "accountNumber", label: "رقم الحساب", ltr: true },
      { key: "iban", label: "الآيبان", ltr: true },
      { key: "swift", label: "السويفت", ltr: true },
      { key: "branch", label: "الفرع" },
      { key: "isActive", label: "نشط", ...yesNo },
    ],
    load: async (id) => {
      const [r] = await db.select({ name: s.accounts.nameAr }).from(s.bankAccounts).innerJoin(s.accounts, eq(s.accounts.id, s.bankAccounts.accountId)).where(eq(s.bankAccounts.id, id));
      return { accountName: r?.name ?? "" };
    },
    after: async (tx, id, v, before) => {
      await renameAccount(tx, before.accountId as number, String(v.accountName));
      if (v.iban) await tx.update(s.bankAccounts).set({ iban: normalizeIban(String(v.iban)) }).where(eq(s.bankAccounts.id, id));
    },
    remove: async (tx, id, row) => {
      await tx.delete(s.bankAccounts).where(eq(s.bankAccounts.id, id));
      await deleteAccounts(tx, [row.accountId as number]);
    },
    instead: "ألغِ علامة «نشط»",
  },

  cost_centers: {
    noun: "مركز التكلفة",
    perm: "cost_centers",
    listHref: "/cost-centers",
    listLabel: "مراكز التكلفة",
    table: table(s.costCenters),
    heading: (r) => `${r.code} ${r.nameAr}`,
    guardDelete: (r) => (r.type === "vehicle" ? "مركز تكلفة المركبة يُحذف مع المركبة نفسها" : null),
    fields: [
      { key: "nameAr", label: "الاسم", required: true },
      { key: "isActive", label: "نشط", ...yesNo },
    ],
    instead: "ألغِ علامة «نشط»",
  },

  vehicle_types: {
    noun: "نوع المركبة",
    perm: "vehicles",
    listHref: "/vehicles",
    listLabel: "المركبات",
    table: table(s.vehicleTypes),
    heading: (r) => `نوع المركبة: ${r.nameAr}`,
    fields: [{ key: "nameAr", label: "الاسم", required: true }],
    instead: "اتركه؛ لا يضر وجوده",
  },

  charge_types: {
    noun: "بند المصروف",
    perm: "waybills",
    listHref: "/settings",
    listLabel: "الإعدادات",
    table: table(s.chargeTypes),
    heading: (r) => String(r.nameAr),
    fields: [
      { key: "nameAr", label: "الاسم", required: true },
      { key: "isActive", label: "نشط", ...yesNo },
    ],
    instead: "ألغِ علامة «نشط»",
  },

  warehouses: {
    noun: "المستودع",
    perm: "inventory",
    listHref: "/inventory",
    listLabel: "المخزون",
    table: table(s.warehouses),
    heading: (r) => String(r.nameAr),
    fields: [
      { key: "code", label: "الرمز", required: true, ltr: true },
      { key: "nameAr", label: "الاسم", required: true },
      { key: "location", label: "الموقع" },
      { key: "isActive", label: "نشط", ...yesNo },
    ],
    instead: "ألغِ علامة «نشط»",
  },

  users: {
    noun: "المستخدم",
    perm: "users",
    listHref: "/users",
    listLabel: "المستخدمون",
    table: table(s.users),
    heading: (r) => String(r.name),
    redirect: async (id) => {
      const [d] = await db.select({ id: s.drivers.id }).from(s.drivers).where(eq(s.drivers.userId, id));
      return d ? `/drivers/${d.id}` : null;
    },
    fields: [
      { key: "name", label: "الاسم", required: true },
      { key: "login", label: "اسم الدخول", required: true, ltr: true },
      { key: "roles", label: "الأدوار", type: "multi", virtual: true, options: async () => (await db.select().from(s.roles).where(ne(s.roles.key, "driver")).orderBy(asc(s.roles.id))).map((r) => ({ value: String(r.id), label: r.nameAr })) },
      { key: "password", label: "كلمة مرور جديدة", type: "password", virtual: true, ltr: true, hint: `اتركها فارغة لتبقى كما هي، أو ${MIN_PASSWORD_LENGTH} أحرف على الأقل` },
      { key: "isActive", label: "نشط (يستطيع الدخول)", ...yesNo },
    ],
    load: async (id) => ({ roles: (await db.select({ id: s.userRoles.roleId }).from(s.userRoles).where(eq(s.userRoles.userId, id))).map((r) => String(r.id)) }),
    after: async (tx, id, v) => {
      const roleIds = (v.roles as string[]).map(Number).filter(Boolean);
      if (!roleIds.length) throw new Error("اختر دوراً واحداً على الأقل");
      await tx.delete(s.userRoles).where(eq(s.userRoles.userId, id));
      await tx.insert(s.userRoles).values(roleIds.map((roleId) => ({ userId: id, roleId })));
      const pw = String(v.password ?? "");
      if (pw) {
        if (pw.length < MIN_PASSWORD_LENGTH) throw new Error(`كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
        await tx.update(s.users).set({ passwordHash: await hashPassword(pw) }).where(eq(s.users.id, id));
        await tx.delete(s.sessions).where(eq(s.sessions.userId, id));
      }
      if (!v.isActive) await tx.delete(s.sessions).where(eq(s.sessions.userId, id));
      // يبقى مدير نظام نشط واحد على الأقل
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.users)
        .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
        .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
        .where(and(eq(s.roles.key, "admin"), eq(s.users.isActive, true)));
      if (!n) throw new Error("يجب أن يبقى مدير نظام نشط واحد على الأقل");
    },
    remove: async (tx, id) => {
      await tx.delete(s.users).where(eq(s.users.id, id));
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.users)
        .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
        .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
        .where(and(eq(s.roles.key, "admin"), eq(s.users.isActive, true)));
      if (!n) throw new Error("يجب أن يبقى مدير نظام نشط واحد على الأقل");
    },
    instead: "ألغِ علامة «نشط» فيتوقف دخوله مع بقاء سجلاته",
  },
};

export type RecordKind = keyof typeof RECORDS;
export const isRecordKind = (k: string): k is RecordKind => Object.hasOwn(RECORDS, k);
export const recordHref = (kind: RecordKind, id: number) => `/records/${kind}/${id}`;

export async function resolveOptions(f: FieldDef): Promise<Opt[]> {
  return typeof f.options === "function" ? f.options() : (f.options ?? []);
}

export async function loadRecord(kind: RecordKind, id: number) {
  const def = RECORDS[kind];
  const t = def.table as unknown as typeof s.vehicles;
  const [row] = (await db.select().from(t).where(eq(t.id, id))) as Row[];
  if (!row) return null;
  return { ...row, ...(def.load ? await def.load(id) : {}) } as Row;
}

/** يقرأ قيم النموذج حسب نوع كل حقل؛ الحقل الفارغ = null. */
export function parseForm(def: RecordDef, data: FormData): Row {
  const out: Row = {};
  for (const f of def.fields) {
    if (f.type === "multi") {
      out[f.key] = data.getAll(f.key).map(String);
      continue;
    }
    if (f.type === "bool") {
      out[f.key] = data.get(f.key) === "on";
      continue;
    }
    const raw = String(data.get(f.key) ?? "").trim();
    if (!raw) {
      if (f.required) throw new Error(`${f.label}: إلزامي`);
      out[f.key] = f.type === "password" ? "" : null;
      continue;
    }
    if (f.type === "number") {
      const n = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(n)) throw new Error(`${f.label}: رقم غير صحيح`);
      out[f.key] = n;
    } else if (f.type === "select" && f.numeric) {
      out[f.key] = Number(raw);
    } else if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new Error(`${f.label}: تاريخ غير صحيح`);
    } else out[f.key] = raw;
  }
  return out;
}

/** الأعمدة الرقمية العشرية تُخزن نصاً في drizzle */
const MONEY_KEYS = new Set(["basicSalary", "housingAllowance", "allowances", "driverCommission", "cost", "creditLimit", "purchasePrice", "salePrice", "reorderLevel", "custodyLimit"]);

export async function saveRecord(kind: RecordKind, id: number, values: Row) {
  const def = RECORDS[kind];
  if (def.save) return def.save(id, values);
  const t = def.table as unknown as typeof s.vehicles;
  await db.transaction(async (tx) => {
    const [before] = (await tx.select().from(t).where(eq(t.id, id)).for("update")) as Row[];
    if (!before) throw new Error(`${def.noun} غير موجود`);
    const set: Row = {};
    for (const f of def.fields) {
      if (f.virtual) continue;
      const v = values[f.key];
      set[f.key] = MONEY_KEYS.has(f.key) && v != null ? String(v) : v;
    }
    if ("updatedAt" in before) set.updatedAt = new Date();
    if (Object.keys(set).length) await tx.update(t).set(set as never).where(eq(t.id, id));
    if (def.after) await def.after(tx, id, values, before);
  });
}

export async function deleteRecord(kind: RecordKind, id: number) {
  const def = RECORDS[kind];
  if (def.del) return def.del(id);
  const t = def.table as unknown as typeof s.vehicles;
  await db.transaction(async (tx) => {
    const [row] = (await tx.select().from(t).where(eq(t.id, id)).for("update")) as Row[];
    if (!row) throw new Error(`${def.noun} غير موجود`);
    const guard = def.guardDelete?.(row);
    if (guard) throw new Error(guard);
    if (def.remove) await def.remove(tx, id, row);
    else await tx.delete(t).where(eq(t.id, id));
  });
}

// ───────────── سجل التعديلات ─────────────

const FIELD_LABELS: Record<string, string> = {};
for (const def of Object.values(RECORDS)) for (const f of def.fields) FIELD_LABELS[f.key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())] ??= f.label;
Object.assign(FIELD_LABELS, {
  status: "الحالة",
  name_ar: "الاسم",
  password_hash: "كلمة المرور",
  user_id: "حساب الدخول",
  total: "الإجمالي",
  notes: "ملاحظات",
  number: "الرقم",
  approved_by: "اعتمده",
  approved_at: "تاريخ الاعتماد",
  posted_at: "تاريخ الترحيل",
  journal_entry_id: "القيد",
});
export const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k;

export async function recordHistory(targets: [string, number | string][], limit = 50) {
  const where = sql.join(
    targets.map(([e, i]) => sql`(${s.auditLog.entity} = ${e} and ${s.auditLog.entityId} = ${String(i)})`),
    sql` or `,
  );
  return db
    .select({ id: s.auditLog.id, action: s.auditLog.action, changes: s.auditLog.changes, at: s.auditLog.at, user: s.users.name })
    .from(s.auditLog)
    .leftJoin(s.users, eq(s.users.id, s.auditLog.userId))
    .where(where)
    .orderBy(sql`${s.auditLog.at} desc, ${s.auditLog.id} desc`)
    .limit(limit);
}

/** اسم جدول قاعدة البيانات للكيان (لسجل التعديلات) */
export const TABLE_NAME: Record<RecordKind, string> = {
  vehicles: "vehicles",
  parties: "parties",
  locations: "locations",
  routes: "routes",
  accounts: "accounts",
  fleet_documents: "fleet_documents",
  employees: "employees",
  contracts: "contracts",
  bank_accounts: "bank_accounts",
  cost_centers: "cost_centers",
  vehicle_types: "vehicle_types",
  charge_types: "charge_types",
  warehouses: "warehouses",
  users: "users",
  drivers: "drivers",
  products: "products",
};
