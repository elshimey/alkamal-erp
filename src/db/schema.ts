// بنية قاعدة البيانات: الأساس المشترك + المحاسبة + المركبات والمستخدمون.
// المرجع: نموذج-البيانات-والوحدات.md (الإصدار الثاني) وشجرة-الحسابات.md.
// الوحدات التالية (التشغيل، المبيعات، المشتريات، الرواتب...) تضيف جداولها بترحيلات لاحقة.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  customType,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: "number" });
const money = (name: string) => numeric(name, { precision: 18, scale: 3 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ───────────────────────── المستخدمون والصلاحيات ─────────────────────────

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  // الجوال أو البريد، وهو اسم الدخول
  login: varchar("login", { length: 120 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  locale: varchar("locale", { length: 5 }).notNull().default("ar"),
  isActive: boolean("is_active").notNull().default(true),
  // الحساب التجريبي: لا يدخل بعد هذا الوقت (فارغ = دائم)
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const roles = pgTable("roles", {
  id: id(),
  // مفتاح الأدوار الأساسية (admin, manager, accountant, driver)؛ فارغ للأدوار المخصصة
  key: varchar("key", { length: 40 }).unique(),
  nameAr: text("name_ar").notNull().unique(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: ref("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: ref("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const permissionScope = pgEnum("permission_scope", ["own", "all"]);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: ref("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    entity: varchar("entity", { length: 60 }).notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    scope: permissionScope("scope").notNull().default("all"),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.entity, t.action] })],
);

export const sessions = pgTable(
  "sessions",
  {
    // تجزئة SHA-256 لرمز الجلسة؛ الرمز نفسه لا يُخزَّن
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: ref("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ───────────────────────── البيانات الأساسية ─────────────────────────

export const currencies = pgTable("currencies", {
  code: varchar("code", { length: 3 }).primaryKey(),
  nameAr: text("name_ar").notNull(),
  decimals: smallint("decimals").notNull().default(2),
  isBase: boolean("is_base").notNull().default(false),
});

export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: id(),
    currencyCode: varchar("currency_code", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    rateDate: date("rate_date").notNull(),
    // قيمة وحدة واحدة من العملة بالريال
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex("exchange_rates_currency_date_uq").on(t.currencyCode, t.rateDate),
    check("exchange_rates_positive", sql`${t.rate} > 0`),
  ],
);

export const partyKind = pgEnum("party_kind", ["individual", "company"]);
export const partyRoleType = pgEnum("party_role_type", [
  "customer",
  "supplier",
  "carrier",
  "workshop",
  "fuel_station",
  "customs_broker",
  "sales_rep",
]);

// جهة الاتصال الموحّدة (أسلوب وافق)؛ الدور يحدد الاستخدام
export const parties = pgTable("parties", {
  id: id(),
  kind: partyKind("kind").notNull().default("company"),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en"),
  vatNumber: varchar("vat_number", { length: 20 }),
  crNumber: varchar("cr_number", { length: 20 }),
  nationalAddress: text("national_address"),
  country: varchar("country", { length: 2 }).notNull().default("SA"),
  mobile: varchar("mobile", { length: 20 }),
  email: varchar("email", { length: 120 }),
  defaultCurrency: varchar("default_currency", { length: 3 })
    .notNull()
    .default("SAR")
    .references(() => currencies.code),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const partyRoles = pgTable(
  "party_roles",
  {
    partyId: ref("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
    role: partyRoleType("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.partyId, t.role] })],
);

export const numberSequences = pgTable(
  "number_sequences",
  {
    docType: varchar("doc_type", { length: 40 }).notNull(),
    year: smallint("year").notNull(),
    prefix: varchar("prefix", { length: 10 }).notNull(),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.docType, t.year] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    entity: varchar("entity", { length: 60 }).notNull(),
    entityId: text("entity_id").notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    // { field: [before, after] }
    changes: jsonb("changes"),
    userId: ref("user_id").references(() => users.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

// القرار 9: الحذف يحفظ نسخة كاملة من المستند وقيده
export const deletionLog = pgTable("deletion_log", {
  id: id(),
  entity: varchar("entity", { length: 60 }).notNull(),
  entityId: text("entity_id").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  reason: text("reason").notNull(),
  userId: ref("user_id").references(() => users.id, { onDelete: "set null" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// ───────────────────────── المحاسبة ─────────────────────────

export const accountType = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "cost_of_revenue",
  "expense",
]);
export const normalBalance = pgEnum("normal_balance", ["debit", "credit"]);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    code: varchar("code", { length: 12 }).notNull().unique(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    parentId: ref("parent_id").references((): AnyPgColumn => accounts.id),
    // 1 القسم، 2 المجموعة، 3 الحساب العام، 4 الحساب التفصيلي
    level: smallint("level").notNull(),
    type: accountType("type").notNull(),
    normalBalance: normalBalance("normal_balance").notNull(),
    // الحساب التجميعي لا يقبل ترحيلاً
    isPostable: boolean("is_postable").notNull(),
    requiresCostCenter: boolean("requires_cost_center").notNull().default(false),
    // عملة إلزامية للحساب (مثل صندوق الدينار)، وفارغ يعني أي عملة
    currencyCode: varchar("currency_code", { length: 3 }).references(() => currencies.code),
    note: text("note"),
    isActive: boolean("is_active").notNull().default(true),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("accounts_parent_idx").on(t.parentId),
    check("accounts_level_range", sql`${t.level} between 1 and 4`),
  ],
);

export const costCenterType = pgEnum("cost_center_type", ["vehicle", "admin", "workshop", "other"]);

export const costCenters = pgTable("cost_centers", {
  id: id(),
  code: varchar("code", { length: 40 }).notNull().unique(),
  nameAr: text("name_ar").notNull(),
  type: costCenterType("type").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const taxKind = pgEnum("tax_kind", ["output", "input", "zero_rated", "exempt"]);

export const taxCodes = pgTable("tax_codes", {
  id: id(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  nameAr: text("name_ar").notNull(),
  kind: taxKind("kind").notNull(),
  rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
  accountId: ref("account_id").references(() => accounts.id),
  isActive: boolean("is_active").notNull().default(true),
});

export const periodStatus = pgEnum("period_status", ["open", "closed"]);

export const fiscalPeriods = pgTable(
  "fiscal_periods",
  {
    id: id(),
    year: smallint("year").notNull(),
    month: smallint("month").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: periodStatus("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: ref("closed_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("fiscal_periods_year_month_uq").on(t.year, t.month),
    check("fiscal_periods_month_range", sql`${t.month} between 1 and 12`),
  ],
);

export const journalStatus = pgEnum("journal_status", ["draft", "pending", "posted"]);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    entryDate: date("entry_date").notNull(),
    description: text("description"),
    // المستند المصدر (نوع + معرّف)؛ فارغ للقيد اليدوي. لكل مستند قيد واحد على الأكثر
    sourceType: varchar("source_type", { length: 40 }),
    sourceId: ref("source_id"),
    status: journalStatus("status").notNull().default("draft"),
    fiscalPeriodId: ref("fiscal_period_id").references(() => fiscalPeriods.id),
    // مرجع القيد اليدوي (رقمه في الملف المستورد أو المستند الورقي)
    reference: varchar("reference", { length: 60 }),
    createdBy: ref("created_by").references(() => users.id),
    approvedBy: ref("approved_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("journal_entries_source_uq")
      .on(t.sourceType, t.sourceId)
      .where(sql`${t.sourceType} is not null`),
    index("journal_entries_date_idx").on(t.entryDate),
    check(
      "journal_entries_source_pair",
      sql`(${t.sourceType} is null) = (${t.sourceId} is null)`,
    ),
  ],
);

// سطر القيد: القلب الذي تُبنى منه كل التقارير.
// الأبعاد: جهة الاتصال، مركز التكلفة (المركبة)، السائق، الشحنة.
export const journalLines = pgTable(
  "journal_lines",
  {
    id: id(),
    entryId: ref("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    lineNo: smallint("line_no").notNull(),
    accountId: ref("account_id").notNull().references(() => accounts.id),
    // المبلغ بعملة السطر
    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    currencyCode: varchar("currency_code", { length: 3 })
      .notNull()
      .default("SAR")
      .references(() => currencies.code),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    // المبلغ بالريال (عملة الأساس)، ومنه يُتحقق توازن القيد
    debitBase: money("debit_base").notNull().default("0"),
    creditBase: money("credit_base").notNull().default("0"),
    description: text("description"),
    taxCodeId: ref("tax_code_id").references(() => taxCodes.id),
    partyId: ref("party_id").references(() => parties.id),
    costCenterId: ref("cost_center_id").references(() => costCenters.id),
    driverId: ref("driver_id").references((): AnyPgColumn => drivers.id),
    waybillId: ref("waybill_id").references((): AnyPgColumn => waybills.id),
  },
  (t) => [
    uniqueIndex("journal_lines_entry_line_uq").on(t.entryId, t.lineNo),
    index("journal_lines_waybill_idx").on(t.waybillId),
    index("journal_lines_account_idx").on(t.accountId),
    index("journal_lines_cost_center_idx").on(t.costCenterId),
    index("journal_lines_party_idx").on(t.partyId),
    index("journal_lines_driver_idx").on(t.driverId),
    check(
      "journal_lines_amounts_valid",
      sql`${t.debit} >= 0 and ${t.credit} >= 0 and (${t.debit} = 0) <> (${t.credit} = 0)
          and ${t.debitBase} >= 0 and ${t.creditBase} >= 0`,
    ),
    check("journal_lines_rate_positive", sql`${t.exchangeRate} > 0`),
  ],
);

// ───────────────────────── الأسطول (الأساس) ─────────────────────────

export const vehicleTypes = pgTable("vehicle_types", {
  id: id(),
  nameAr: text("name_ar").notNull().unique(),
});

export const vehicleOwnership = pgEnum("vehicle_ownership", ["owned", "leased"]);
export const vehicleStatus = pgEnum("vehicle_status", ["active", "maintenance", "stopped", "sold"]);

export const vehicles = pgTable("vehicles", {
  id: id(),
  plate: varchar("plate", { length: 30 }).notNull().unique(),
  chassis: varchar("chassis", { length: 40 }).notNull().unique(),
  serialNumber: varchar("serial_number", { length: 40 }),
  vehicleTypeId: ref("vehicle_type_id").references(() => vehicleTypes.id),
  make: text("make"),
  model: text("model"),
  year: smallint("year"),
  color: text("color"),
  registrationType: text("registration_type"),
  ownership: vehicleOwnership("ownership").notNull().default("owned"),
  ownershipDate: date("ownership_date"),
  customsDocument: text("customs_document"),
  odometer: integer("odometer").notNull().default(0),
  status: vehicleStatus("status").notNull().default("active"),
  // حساب الأصل في الشجرة (الشاحنات، المقطورات، السيارات الخفيفة)
  assetAccountId: ref("asset_account_id").references(() => accounts.id),
  // القرار 8: كل مركبة لها مركز تكلفة واحد يُنشأ تلقائياً عند إضافتها
  costCenterId: ref("cost_center_id")
    .notNull()
    .unique()
    .references(() => costCenters.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────── الموظفون والسائقون ─────────────────────────

export const employeeStatus = pgEnum("employee_status", ["active", "on_leave", "terminated"]);

export const employees = pgTable("employees", {
  id: id(),
  nameAr: text("name_ar").notNull(),
  nationalId: varchar("national_id", { length: 20 }).unique(),
  jobTitle: text("job_title"),
  hireDate: date("hire_date"),
  basicSalary: money("basic_salary").notNull().default("0"),
  housingAllowance: money("housing_allowance").notNull().default("0"),
  // بدلات أخرى (نقل، طعام...)
  allowances: money("allowances").notNull().default("0"),
  // سعودي: يُستقطع منه نصيبه في التأمينات؛ غير السعودي: أخطار مهنية على المنشأة فقط
  isSaudi: boolean("is_saudi").notNull().default(false),
  gosiSubject: boolean("gosi_subject").notNull().default(true),
  bankName: text("bank_name"),
  iban: varchar("iban", { length: 34 }),
  // حساب الرواتب المستحقة الخاص به (فرعي تحت 2107)، وإليه تُقيد العمولات والخصومات
  payableAccountId: ref("payable_account_id").unique().references(() => accounts.id),
  // عهدة الموظف الإداري (فرعي تحت 1105)، تُفتح عند أول عهدة نقدية. السائق عهدته في جدول السائقين
  custodyAccountId: ref("custody_account_id").unique().references(() => accounts.id),
  status: employeeStatus("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const commissionClass = pgEnum("commission_class", ["domestic", "international"]);
export const appLanguage = pgEnum("app_language", ["ar", "ur", "hi", "en"]);

export const drivers = pgTable("drivers", {
  id: id(),
  // السائق مرتبط بموظف إلزامياً لأن العمولة تُقيد لحساب راتبه
  employeeId: ref("employee_id").notNull().unique().references(() => employees.id),
  mobile: varchar("mobile", { length: 20 }),
  nationality: text("nationality"),
  appLanguage: appLanguage("app_language").notNull().default("ar"),
  residencyNumber: varchar("residency_number", { length: 20 }),
  licenseNumber: varchar("license_number", { length: 30 }),
  transportCardNumber: varchar("transport_card_number", { length: 30 }),
  birthDate: date("birth_date"),
  commissionClass: commissionClass("commission_class").notNull().default("domestic"),
  // حساب عهدته (فرعي تحت 1105)
  custodyAccountId: ref("custody_account_id").notNull().unique().references(() => accounts.id),
  custodyLimit: money("custody_limit"),
  userId: ref("user_id").unique().references(() => users.id, { onDelete: "set null" }),
  status: employeeStatus("status").notNull().default("active"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// من كان يقود المركبة ومتى؛ إسناد مفتوح واحد على الأكثر لكل مركبة ولكل سائق
export const vehicleAssignments = pgTable(
  "vehicle_assignments",
  {
    id: id(),
    vehicleId: ref("vehicle_id").notNull().references(() => vehicles.id),
    driverId: ref("driver_id").notNull().references(() => drivers.id),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date"),
    odometerStart: integer("odometer_start"),
    odometerEnd: integer("odometer_end"),
    notes: text("notes"),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("vehicle_assignments_open_vehicle_uq").on(t.vehicleId).where(sql`${t.toDate} is null`),
    uniqueIndex("vehicle_assignments_open_driver_uq").on(t.driverId).where(sql`${t.toDate} is null`),
    index("vehicle_assignments_vehicle_idx").on(t.vehicleId, t.fromDate),
    check("vehicle_assignments_dates", sql`${t.toDate} is null or ${t.toDate} >= ${t.fromDate}`),
    check(
      "vehicle_assignments_odometer",
      sql`${t.odometerEnd} is null or ${t.odometerStart} is null or ${t.odometerEnd} >= ${t.odometerStart}`,
    ),
  ],
);

export const fleetDocumentType = pgEnum("fleet_document_type", [
  "registration",
  "periodic_inspection",
  "operating_card",
  "insurance",
  "authorization",
  "license",
  "residency",
  "other",
]);

export const fleetDocuments = pgTable(
  "fleet_documents",
  {
    id: id(),
    // صاحب الوثيقة: مركبة أو سائق
    vehicleId: ref("vehicle_id").references(() => vehicles.id, { onDelete: "cascade" }),
    driverId: ref("driver_id").references(() => drivers.id, { onDelete: "cascade" }),
    type: fleetDocumentType("type").notNull(),
    number: varchar("number", { length: 40 }),
    issueDate: date("issue_date"),
    expiryDate: date("expiry_date").notNull(),
    authority: text("authority"),
    cost: money("cost"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("fleet_documents_expiry_idx").on(t.expiryDate),
    check("fleet_documents_one_owner", sql`(${t.vehicleId} is null) <> (${t.driverId} is null)`),
  ],
);

// ───────────────────────── التشغيل: المواقع والمسارات والعقود ─────────────────────────

export const locationLevel = pgEnum("location_level", ["country", "city", "site"]);

// هرمي: دولة ← مدينة ← موقع (مصنع، ميناء، منفذ حدودي...)
export const locations = pgTable(
  "locations",
  {
    id: id(),
    parentId: ref("parent_id").references((): AnyPgColumn => locations.id),
    level: locationLevel("level").notNull(),
    nameAr: text("name_ar").notNull(),
    // رمز الدولة (SA، KW) للدولة، ويُورَّث للمدن والمواقع لمعرفة الرحلة الدولية
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    isBorderCrossing: boolean("is_border_crossing").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("locations_parent_name_uq").on(sql`coalesce(${t.parentId}, 0)`, t.nameAr),
    check("locations_country_root", sql`(${t.level} = 'country') = (${t.parentId} is null)`),
  ],
);

export const routes = pgTable(
  "routes",
  {
    id: id(),
    fromLocationId: ref("from_location_id").notNull().references(() => locations.id),
    toLocationId: ref("to_location_id").notNull().references(() => locations.id),
    distanceKm: integer("distance_km"),
    isInternational: boolean("is_international").notNull().default(false),
    // العمولة الافتراضية للسائق، وتُعدَّل على الشحنة قبل الاعتماد
    driverCommission: money("driver_commission").notNull().default("0"),
    estimatedDieselLiters: integer("estimated_diesel_liters"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("routes_from_to_uq").on(t.fromLocationId, t.toLocationId),
    check("routes_distinct_ends", sql`${t.fromLocationId} <> ${t.toLocationId}`),
  ],
);

export const contractStatus = pgEnum("contract_status", ["draft", "active", "expired", "suspended"]);

export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    customerId: ref("customer_id").notNull().references(() => parties.id),
    number: varchar("number", { length: 30 }).notNull().unique(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    creditLimit: money("credit_limit"),
    paymentTermsDays: smallint("payment_terms_days").notNull().default(30),
    status: contractStatus("status").notNull().default("draft"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contracts_customer_idx").on(t.customerId, t.status),
    check("contracts_dates", sql`${t.toDate} >= ${t.fromDate}`),
  ],
);

export const pricingMethod = pgEnum("pricing_method", [
  "per_km_vehicle_type", // ريال/كم حسب نوع المركبة
  "specific_vehicle", // سعر لمركبة محددة على مسار
  "route_fixed", // مسار بسعر ثابت
  "car_transport", // نقل سيارة مقطوع
  "per_quantity", // بالكمية (طن، كرتون...)
]);

export const contractRates = pgTable(
  "contract_rates",
  {
    id: id(),
    contractId: ref("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    method: pricingMethod("method").notNull(),
    routeId: ref("route_id").references(() => routes.id),
    vehicleTypeId: ref("vehicle_type_id").references(() => vehicleTypes.id),
    vehicleId: ref("vehicle_id").references(() => vehicles.id),
    price: money("price").notNull(),
    // الوحدة لطريقة الكمية (طن، كرتون، رحلة...)
    unit: text("unit"),
    notes: text("notes"),
  },
  (t) => [
    index("contract_rates_contract_idx").on(t.contractId),
    check("contract_rates_price_positive", sql`${t.price} > 0`),
    check(
      "contract_rates_method_refs",
      sql`case ${t.method}
        when 'per_km_vehicle_type' then ${t.vehicleTypeId} is not null
        when 'specific_vehicle' then ${t.vehicleId} is not null and ${t.routeId} is not null
        when 'route_fixed' then ${t.routeId} is not null
        when 'car_transport' then ${t.routeId} is not null
        when 'per_quantity' then ${t.unit} is not null
      end`,
    ),
  ],
);

// أنواع الرسوم الإضافية على الشحنة (انتظار، تحميل، تخليص، مبيت...)
export const chargeTypes = pgTable("charge_types", {
  id: id(),
  nameAr: text("name_ar").notNull().unique(),
  revenueAccountId: ref("revenue_account_id").references(() => accounts.id),
  costAccountId: ref("cost_account_id").references(() => accounts.id),
  isActive: boolean("is_active").notNull().default(true),
});

// ───────────────────────── الشحنة (الرحلة) ─────────────────────────

// مسودة ← في الطريق ← مُسلَّمة ← معتمدة ← مفوترة؛ أو مرفوضة (تعود للتصحيح مع السبب)
export const waybillStatus = pgEnum("waybill_status", ["draft", "in_transit", "delivered", "approved", "invoiced", "rejected"]);
export const waybillExecution = pgEnum("waybill_execution", ["fleet", "carrier"]);

export const waybills = pgTable(
  "waybills",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    waybillDate: date("waybill_date").notNull(),
    customerId: ref("customer_id").notNull().references(() => parties.id),
    contractId: ref("contract_id").references(() => contracts.id),
    routeId: ref("route_id").notNull().references(() => routes.id),
    shipper: text("shipper").notNull(),
    consignee: text("consignee").notNull(),
    deliveryAddress: text("delivery_address"),
    isInternational: boolean("is_international").notNull().default(false),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    // التنفيذ: أسطول داخلي (مركبة + سائق) أو ناقل خارجي، لا الاثنين
    execution: waybillExecution("execution").notNull().default("fleet"),
    vehicleId: ref("vehicle_id").references(() => vehicles.id),
    driverId: ref("driver_id").references(() => drivers.id),
    carrierId: ref("carrier_id").references(() => parties.id),
    carrierCost: money("carrier_cost"),
    carrierDriverName: text("carrier_driver_name"),
    carrierDriverMobile: varchar("carrier_driver_mobile", { length: 20 }),
    carrierPlate: varchar("carrier_plate", { length: 30 }),
    distanceKm: integer("distance_km"),
    weightTons: numeric("weight_tons", { precision: 10, scale: 3 }),
    containerNumber: varchar("container_number", { length: 30 }),
    customsDeclaration: varchar("customs_declaration", { length: 40 }),
    deliveryNoteNumber: varchar("delivery_note_number", { length: 40 }),
    // المالي
    amount: money("amount").notNull().default("0"),
    taxCodeId: ref("tax_code_id").references(() => taxCodes.id),
    // شرح مصدر السعر (بند العقد المطبَّق) للمراجعة
    priceNote: text("price_note"),
    driverCommission: money("driver_commission").notNull().default("0"),
    salesRepId: ref("sales_rep_id").references(() => parties.id),
    salesRepCommission: money("sales_rep_commission").notNull().default("0"),
    odometerStart: integer("odometer_start"),
    odometerEnd: integer("odometer_end"),
    emptyReturn: boolean("empty_return").notNull().default(false),
    returnWaybillId: ref("return_waybill_id").references((): AnyPgColumn => waybills.id),
    notes: text("notes"),
    status: waybillStatus("status").notNull().default("draft"),
    rejectionReason: text("rejection_reason"),
    // سبب تجاوز الضوابط (بلا عقد ساري، الحد الائتماني) لمن يملك الصلاحية
    overrideReason: text("override_reason"),
    approvedBy: ref("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("waybills_status_idx").on(t.status, t.waybillDate),
    index("waybills_customer_idx").on(t.customerId),
    index("waybills_vehicle_idx").on(t.vehicleId, t.waybillDate),
    index("waybills_driver_idx").on(t.driverId, t.waybillDate),
    check(
      "waybills_execution_refs",
      sql`case ${t.execution}
        when 'fleet' then ${t.vehicleId} is not null and ${t.driverId} is not null and ${t.carrierId} is null
        when 'carrier' then ${t.carrierId} is not null and ${t.vehicleId} is null and ${t.driverId} is null
      end`,
    ),
    check("waybills_amounts", sql`${t.amount} >= 0 and ${t.driverCommission} >= 0 and ${t.salesRepCommission} >= 0 and coalesce(${t.carrierCost}, 0) >= 0`),
    check("waybills_odometer", sql`${t.odometerEnd} is null or ${t.odometerStart} is null or ${t.odometerEnd} >= ${t.odometerStart}`),
  ],
);

export const tripStageType = pgEnum("trip_stage_type", ["loading", "in_transit", "border", "delivery"]);

export const tripStages = pgTable(
  "trip_stages",
  {
    id: id(),
    waybillId: ref("waybill_id").notNull().references(() => waybills.id, { onDelete: "cascade" }),
    stage: tripStageType("stage").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    odometer: integer("odometer"),
    note: text("note"),
    createdBy: ref("created_by").references(() => users.id),
  },
  (t) => [index("trip_stages_waybill_idx").on(t.waybillId, t.at)],
);

// الديزل يُقيد حسب مصدره الفعلي (القرار 4)
export const fuelSource = pgEnum("fuel_source", ["custody", "fuel_card", "station_credit"]);

export const waybillFuel = pgTable(
  "waybill_fuel",
  {
    id: id(),
    waybillId: ref("waybill_id").notNull().references(() => waybills.id, { onDelete: "cascade" }),
    source: fuelSource("source").notNull(),
    // المحطة (للآجل) أو مزوّد البطاقة
    partyId: ref("party_id").references(() => parties.id),
    liters: numeric("liters", { precision: 10, scale: 2 }),
    // المبلغ قبل الضريبة، والضريبة منفصلة لتُقيد مدخلات
    amount: money("amount").notNull(),
    vatAmount: money("vat_amount").notNull().default("0"),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    odometer: integer("odometer"),
    invoiceNumber: varchar("invoice_number", { length: 40 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("waybill_fuel_waybill_idx").on(t.waybillId),
    check("waybill_fuel_amounts", sql`${t.amount} > 0 and ${t.vatAmount} >= 0 and ${t.exchangeRate} > 0`),
    check("waybill_fuel_station", sql`${t.source} <> 'station_credit' or ${t.partyId} is not null`),
  ],
);

export const expenseBillTo = pgEnum("expense_bill_to", ["company", "customer"]);
export const expensePayer = pgEnum("expense_payer", ["driver_custody", "customs_broker"]);

// مصاريف الحدود والطريق على الشحنة؛ ما يكون على العميل يُسحب للفاتورة كرسوم
export const waybillExpenses = pgTable(
  "waybill_expenses",
  {
    id: id(),
    waybillId: ref("waybill_id").notNull().references(() => waybills.id, { onDelete: "cascade" }),
    chargeTypeId: ref("charge_type_id").notNull().references(() => chargeTypes.id),
    amount: money("amount").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    billTo: expenseBillTo("bill_to").notNull().default("company"),
    payer: expensePayer("payer").notNull().default("driver_custody"),
    // المخلص عند الدفع عن طريقه
    partyId: ref("party_id").references(() => parties.id),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("waybill_expenses_waybill_idx").on(t.waybillId),
    check("waybill_expenses_amounts", sql`${t.amount} > 0 and ${t.exchangeRate} > 0`),
    check("waybill_expenses_broker", sql`${t.payer} <> 'customs_broker' or ${t.partyId} is not null`),
  ],
);

// ───────────────────────── المبيعات: الفاتورة التجميعية والتحصيل ─────────────────────────

export const invoiceStatus = pgEnum("invoice_status", ["draft", "issued"]);
// حالة الربط مع هيئة الزكاة (الفوترة الإلكترونية)
export const zatcaStatus = pgEnum("zatca_status", ["not_sent", "accepted", "rejected"]);

export const salesInvoices = pgTable(
  "sales_invoices",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date").notNull(),
    customerId: ref("customer_id").notNull().references(() => parties.id),
    contractId: ref("contract_id").references(() => contracts.id),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    subtotal: money("subtotal").notNull().default("0"),
    vatTotal: money("vat_total").notNull().default("0"),
    total: money("total").notNull().default("0"),
    // مجموع ما خُصص لها من سندات القبض المرحّلة
    paidAmount: money("paid_amount").notNull().default("0"),
    status: invoiceStatus("status").notNull().default("draft"),
    zatcaStatus: zatcaStatus("zatca_status").notNull().default("not_sent"),
    zatcaResponse: text("zatca_response"),
    notes: text("notes"),
    // رقم الفاتورة في الملف المستورد أو النظام السابق؛ يمنع استيراد الفاتورة مرتين
    reference: varchar("reference", { length: 60 }).unique(),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    issuedBy: ref("issued_by").references(() => users.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sales_invoices_customer_idx").on(t.customerId, t.status),
    check("sales_invoices_dates", sql`${t.dueDate} >= ${t.invoiceDate}`),
    check("sales_invoices_paid", sql`${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.total}`),
  ],
);

export const invoiceLineKind = pgEnum("invoice_line_kind", ["waybill", "expense", "manual"]);

// سطر لكل شحنة (والشحنة لا تُفوتر مرتين)، أو مصروف محمّل على العميل، أو سطر حر (مستورد من Excel)
export const salesInvoiceLines = pgTable(
  "sales_invoice_lines",
  {
    id: id(),
    invoiceId: ref("invoice_id").notNull().references(() => salesInvoices.id, { onDelete: "cascade" }),
    lineNo: smallint("line_no").notNull(),
    kind: invoiceLineKind("kind").notNull(),
    waybillId: ref("waybill_id").references(() => waybills.id),
    waybillExpenseId: ref("waybill_expense_id").references(() => waybillExpenses.id),
    description: text("description").notNull(),
    // للسطر الحر: الكمية وسعر الوحدة كما وردا، والمبلغ بعد الخصم وقبل الضريبة
    quantity: numeric("quantity", { precision: 14, scale: 3 }),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }),
    amount: money("amount").notNull(),
    taxCodeId: ref("tax_code_id").references(() => taxCodes.id),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    vatAmount: money("vat_amount").notNull().default("0"),
    accountId: ref("account_id").notNull().references(() => accounts.id),
    // مركز التكلفة = مركبة الشحنة (أو مركز الناقلين الخارجيين)
    costCenterId: ref("cost_center_id").references(() => costCenters.id),
  },
  (t) => [
    uniqueIndex("sales_invoice_lines_waybill_uq").on(t.waybillId).where(sql`${t.kind} = 'waybill'`),
    uniqueIndex("sales_invoice_lines_expense_uq").on(t.waybillExpenseId).where(sql`${t.waybillExpenseId} is not null`),
    index("sales_invoice_lines_invoice_idx").on(t.invoiceId),
    check(
      "sales_invoice_lines_refs",
      sql`case ${t.kind}
        when 'waybill' then ${t.waybillId} is not null and ${t.waybillExpenseId} is null
        when 'expense' then ${t.waybillExpenseId} is not null
        else ${t.waybillId} is null and ${t.waybillExpenseId} is null
      end`,
    ),
    check("sales_invoice_lines_amounts", sql`${t.amount} >= 0 and ${t.vatAmount} >= 0`),
  ],
);

export const paymentMethod = pgEnum("payment_method", ["cash", "transfer", "cheque", "card"]);
export const receiptStatus = pgEnum("receipt_status", ["draft", "posted"]);
// دفعة عن فواتير، أو دفعة مقدمة (التزام للعميل 2112 حتى تُطبق على فواتيره)، أو استرداد لرصيده
export const receiptKind = pgEnum("receipt_kind", ["invoice_payment", "advance", "refund"]);

export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    kind: receiptKind("kind").notNull().default("invoice_payment"),
    receiptDate: date("receipt_date").notNull(),
    customerId: ref("customer_id").notNull().references(() => parties.id),
    amount: money("amount").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    method: paymentMethod("method").notNull(),
    // الصندوق أو البنك (حساب تفصيلي تحت 1101 أو 1102)
    cashAccountId: ref("cash_account_id").notNull().references(() => accounts.id),
    // المحصّل حقل مستقل (العيب 13)
    collector: text("collector"),
    reference: varchar("reference", { length: 60 }),
    notes: text("notes"),
    // التوزيع المحدد على الفواتير والتعديلات (خصم مسموح، رسوم بنكية) قبل الترحيل؛ فارغ = الأقدم استحقاقاً
    plan: jsonb("plan").$type<ReceiptPlan>(),
    status: receiptStatus("status").notNull().default("draft"),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("receipts_customer_idx").on(t.customerId, t.receiptDate),
    check("receipts_amount_positive", sql`${t.amount} > 0 and ${t.exchangeRate} > 0`),
  ],
);

// تخصيص القبض على الفواتير (يُغذي تقرير الأعمار)
export const receiptAllocations = pgTable(
  "receipt_allocations",
  {
    receiptId: ref("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
    invoiceId: ref("invoice_id").notNull().references(() => salesInvoices.id),
    amount: money("amount").notNull(),
    // تطبيق الدفعة المقدمة على الفاتورة له قيده (مدين 2112 دائن العملاء)
    entryId: ref("entry_id").references(() => journalEntries.id),
  },
  (t) => [
    primaryKey({ columns: [t.receiptId, t.invoiceId] }),
    index("receipt_allocations_invoice_idx").on(t.invoiceId),
    check("receipt_allocations_positive", sql`${t.amount} > 0`),
  ],
);

export interface ReceiptPlan {
  invoiceId?: number;
  allocations?: { invoiceId: number; amount: number }[];
  adjustments?: { accountId: number; amount: number; description: string }[];
}

// تعديلات سند القبض: خصم مسموح به أو رسوم بنكية تُسوّى بها الفواتير مع المبلغ المستلم
export const receiptAdjustments = pgTable(
  "receipt_adjustments",
  {
    id: id(),
    receiptId: ref("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
    accountId: ref("account_id").notNull().references(() => accounts.id),
    amount: money("amount").notNull(),
    description: text("description").notNull(),
  },
  (t) => [index("receipt_adjustments_receipt_idx").on(t.receiptId), check("receipt_adjustments_positive", sql`${t.amount} > 0`)],
);

// ───────────── المشتريات والمصروفات ─────────────

export const purchaseStatus = pgEnum("purchase_status", ["draft", "posted"]);

// فاتورة المورد: تكلفة أو مصروف بسطوره (الحساب ومركز التكلفة)، ودائنة لحساب دور المورد
export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    supplierId: ref("supplier_id").notNull().references(() => parties.id),
    // رقم فاتورة المورد نفسه، ولا يتكرر للمورد الواحد
    supplierInvoiceNo: varchar("supplier_invoice_no", { length: 60 }).notNull(),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    // ذمم الموردين أو الناقلين أو المحطات أو الورش أو المخلصين حسب دور الجهة
    payableAccountId: ref("payable_account_id").notNull().references(() => accounts.id),
    subtotal: money("subtotal").notNull().default("0"),
    vatTotal: money("vat_total").notNull().default("0"),
    total: money("total").notNull().default("0"),
    paidAmount: money("paid_amount").notNull().default("0"),
    status: purchaseStatus("status").notNull().default("draft"),
    notes: text("notes"),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    postedBy: ref("posted_by").references(() => users.id),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("purchase_invoices_supplier_no_uq").on(t.supplierId, t.supplierInvoiceNo),
    index("purchase_invoices_supplier_idx").on(t.supplierId, t.status),
    check("purchase_invoices_dates", sql`${t.dueDate} >= ${t.invoiceDate}`),
    check("purchase_invoices_paid", sql`${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.total}`),
  ],
);

export const purchaseInvoiceLines = pgTable(
  "purchase_invoice_lines",
  {
    id: id(),
    invoiceId: ref("invoice_id").notNull().references(() => purchaseInvoices.id, { onDelete: "cascade" }),
    lineNo: smallint("line_no").notNull(),
    accountId: ref("account_id").notNull().references(() => accounts.id),
    costCenterId: ref("cost_center_id").references(() => costCenters.id),
    // صنف مخزني يدخل المستودع عند الترحيل (الحساب حينها حساب المخزون)
    productId: ref("product_id").references((): AnyPgColumn => products.id),
    warehouseId: ref("warehouse_id").references((): AnyPgColumn => warehouses.id),
    quantity: numeric("quantity", { precision: 12, scale: 3 }),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    taxCodeId: ref("tax_code_id").references(() => taxCodes.id),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    vatAmount: money("vat_amount").notNull().default("0"),
  },
  (t) => [index("purchase_invoice_lines_invoice_idx").on(t.invoiceId), check("purchase_invoice_lines_amounts", sql`${t.amount} > 0 and ${t.vatAmount} >= 0`)],
);

// ───────────── الإشعارات الدائنة والمدينة ─────────────

// إشعار دائن للعميل (يخفض الفاتورة والإيراد والضريبة)، إشعار مدين للعميل (يزيدها)،
// إشعار مدين للمورد (مرتجع أو خصم يخفض ذمته)، إشعار دائن من المورد (يزيدها)
export const noteKind = pgEnum("note_kind", ["sales_credit", "sales_debit", "purchase_debit", "purchase_credit"]);

export const adjustmentNotes = pgTable(
  "adjustment_notes",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    kind: noteKind("kind").notNull(),
    noteDate: date("note_date").notNull(),
    partyId: ref("party_id").notNull().references(() => parties.id),
    salesInvoiceId: ref("sales_invoice_id").references(() => salesInvoices.id),
    purchaseInvoiceId: ref("purchase_invoice_id").references(() => purchaseInvoices.id),
    // ذمة المورد حسب دوره (لإشعارات المشتريات)
    payableAccountId: ref("payable_account_id").references(() => accounts.id),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    reason: text("reason").notNull(),
    subtotal: money("subtotal").notNull().default("0"),
    vatTotal: money("vat_total").notNull().default("0"),
    total: money("total").notNull().default("0"),
    // ما خُصم من رصيد الفاتورة المرتبطة عند الترحيل
    appliedAmount: money("applied_amount").notNull().default("0"),
    status: purchaseStatus("status").notNull().default("draft"),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("adjustment_notes_party_idx").on(t.partyId, t.kind),
    check(
      "adjustment_notes_invoice",
      sql`(${t.kind} in ('sales_credit', 'sales_debit') and ${t.purchaseInvoiceId} is null) or (${t.kind} in ('purchase_debit', 'purchase_credit') and ${t.salesInvoiceId} is null and ${t.payableAccountId} is not null)`,
    ),
  ],
);

export const adjustmentNoteLines = pgTable(
  "adjustment_note_lines",
  {
    id: id(),
    noteId: ref("note_id").notNull().references(() => adjustmentNotes.id, { onDelete: "cascade" }),
    lineNo: smallint("line_no").notNull(),
    description: text("description").notNull(),
    accountId: ref("account_id").notNull().references(() => accounts.id),
    costCenterId: ref("cost_center_id").references(() => costCenters.id),
    amount: money("amount").notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    vatAmount: money("vat_amount").notNull().default("0"),
  },
  (t) => [index("adjustment_note_lines_note_idx").on(t.noteId), check("adjustment_note_lines_amounts", sql`${t.amount} > 0 and ${t.vatAmount} >= 0`)],
);

export const directExpensePayer = pgEnum("direct_expense_payer", ["driver_custody", "cash"]);
export const expenseStatus = pgEnum("expense_status", ["pending", "approved", "rejected"]);

// المصروف المباشر: من عهدة سائق أو من صندوق/بنك، ويُقيد عند الاعتماد
export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    expenseDate: date("expense_date").notNull(),
    payer: directExpensePayer("payer").notNull(),
    driverId: ref("driver_id").references(() => drivers.id),
    cashAccountId: ref("cash_account_id").references(() => accounts.id),
    accountId: ref("account_id").notNull().references(() => accounts.id),
    vehicleId: ref("vehicle_id").references(() => vehicles.id),
    costCenterId: ref("cost_center_id").references(() => costCenters.id),
    waybillId: ref("waybill_id").references(() => waybills.id),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    vatAmount: money("vat_amount").notNull().default("0"),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    // مرجع إيصال المحل ورقمه الضريبي (لاسترداد ضريبة المدخلات)
    vendorName: text("vendor_name"),
    reference: varchar("reference", { length: 60 }),
    status: expenseStatus("status").notNull().default("pending"),
    rejectReason: text("reject_reason"),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    approvedBy: ref("approved_by").references(() => users.id),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("expenses_status_idx").on(t.status, t.expenseDate),
    check("expenses_amounts", sql`${t.amount} > 0 and ${t.vatAmount} >= 0 and ${t.exchangeRate} > 0`),
    check(
      "expenses_payer_refs",
      sql`case ${t.payer} when 'driver_custody' then ${t.driverId} is not null when 'cash' then ${t.cashAccountId} is not null end`,
    ),
  ],
);

export const paymentKind = pgEnum("payment_kind", ["supplier", "custody"]);

// سند الصرف: سداد لمورد (بنفس منطق القبض) أو صرف عهدة لسائق
export const payments = pgTable(
  "payments",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    paymentDate: date("payment_date").notNull(),
    kind: paymentKind("kind").notNull(),
    partyId: ref("party_id").references(() => parties.id),
    driverId: ref("driver_id").references(() => drivers.id),
    // الحساب المدين: ذمة المورد أو عهدة السائق
    debitAccountId: ref("debit_account_id").notNull().references(() => accounts.id),
    amount: money("amount").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    method: paymentMethod("method").notNull(),
    cashAccountId: ref("cash_account_id").notNull().references(() => accounts.id),
    reference: varchar("reference", { length: 60 }),
    notes: text("notes"),
    status: receiptStatus("status").notNull().default("draft"),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_party_idx").on(t.partyId, t.paymentDate),
    check("payments_amount_positive", sql`${t.amount} > 0 and ${t.exchangeRate} > 0`),
    check("payments_kind_refs", sql`case ${t.kind} when 'supplier' then ${t.partyId} is not null when 'custody' then ${t.driverId} is not null end`),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    paymentId: ref("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
    invoiceId: ref("invoice_id").notNull().references(() => purchaseInvoices.id),
    amount: money("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentId, t.invoiceId] }),
    index("payment_allocations_invoice_idx").on(t.invoiceId),
    check("payment_allocations_positive", sql`${t.amount} > 0`),
  ],
);

// ───────────── الصيانة ─────────────

export const maintenanceType = pgEnum("maintenance_type", ["consumable", "electrical", "body_paint", "mechanical", "tires", "other"]);
export const maintenanceProvider = pgEnum("maintenance_provider", ["internal", "external"]);
export const maintenanceStatus = pgEnum("maintenance_status", ["draft", "approved", "completed"]);
export const maintenanceLineKind = pgEnum("maintenance_line_kind", ["part", "labor"]);
export const breakdownStatus = pgEnum("breakdown_status", ["pending_supervisor", "pending_approval", "approved", "in_progress", "completed", "rejected"]);
export const breakdownPriority = pgEnum("breakdown_priority", ["low", "normal", "urgent"]);

// خطة الصيانة الدورية: التنبيه حسب المدة فقط (القرار 13)
export const maintenancePlans = pgTable(
  "maintenance_plans",
  {
    id: id(),
    vehicleId: ref("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
    type: maintenanceType("type").notNull(),
    title: text("title").notNull(),
    intervalDays: integer("interval_days").notNull(),
    lastDoneDate: date("last_done_date"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("maintenance_plans_vehicle_title_uq").on(t.vehicleId, t.title),
    check("maintenance_plans_interval", sql`${t.intervalDays} between 1 and 3650`),
  ],
);

// طلب العطل: من السائق أو المكتب، ويتحول إلى أمر صيانة بعد الاعتماد
export const breakdownRequests = pgTable(
  "breakdown_requests",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    vehicleId: ref("vehicle_id").notNull().references(() => vehicles.id),
    driverId: ref("driver_id").references(() => drivers.id),
    reportDate: date("report_date").notNull(),
    description: text("description").notNull(),
    priority: breakdownPriority("priority").notNull().default("normal"),
    estimatedCost: money("estimated_cost"),
    status: breakdownStatus("status").notNull().default("pending_supervisor"),
    rejectReason: text("reject_reason"),
    reviewedBy: ref("reviewed_by").references(() => users.id),
    approvedBy: ref("approved_by").references(() => users.id),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("breakdown_requests_status_idx").on(t.status), check("breakdown_requests_cost", sql`${t.estimatedCost} is null or ${t.estimatedCost} >= 0`)],
);

export const maintenanceOrders = pgTable(
  "maintenance_orders",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    vehicleId: ref("vehicle_id").notNull().references(() => vehicles.id),
    orderDate: date("order_date").notNull(),
    type: maintenanceType("type").notNull(),
    provider: maintenanceProvider("provider").notNull(),
    // الورشة الخارجية (دائنة)، أو الصندوق الذي تُشترى منه القطع للورشة الداخلية
    supplierId: ref("supplier_id").references(() => parties.id),
    supplierInvoiceNo: varchar("supplier_invoice_no", { length: 60 }),
    cashAccountId: ref("cash_account_id").references(() => accounts.id),
    odometer: integer("odometer"),
    breakdownRequestId: ref("breakdown_request_id").references(() => breakdownRequests.id),
    planId: ref("plan_id").references(() => maintenancePlans.id),
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("SAR").references(() => currencies.code),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull().default("1"),
    subtotal: money("subtotal").notNull().default("0"),
    vatTotal: money("vat_total").notNull().default("0"),
    total: money("total").notNull().default("0"),
    status: maintenanceStatus("status").notNull().default("draft"),
    completedDate: date("completed_date"),
    notes: text("notes"),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    approvedBy: ref("approved_by").references(() => users.id),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("maintenance_orders_vehicle_idx").on(t.vehicleId, t.orderDate),
    uniqueIndex("maintenance_orders_request_uq").on(t.breakdownRequestId).where(sql`${t.breakdownRequestId} is not null`),
    uniqueIndex("maintenance_orders_supplier_no_uq").on(t.supplierId, t.supplierInvoiceNo).where(sql`${t.supplierInvoiceNo} is not null`),
    check(
      "maintenance_orders_provider_refs",
      sql`case ${t.provider} when 'external' then ${t.supplierId} is not null when 'internal' then ${t.supplierId} is null end`,
    ),
    check("maintenance_orders_completed", sql`${t.completedDate} is null or ${t.completedDate} >= ${t.orderDate}`),
  ],
);

// بند أمر الصيانة: قطعة غيار أو شغل يد؛ بند واحد على الأقل إلزامي (العيب 8)
export const maintenanceLines = pgTable(
  "maintenance_lines",
  {
    id: id(),
    orderId: ref("order_id").notNull().references(() => maintenanceOrders.id, { onDelete: "cascade" }),
    lineNo: smallint("line_no").notNull(),
    kind: maintenanceLineKind("kind").notNull(),
    // قطعة تُصرف من المستودع بمتوسط التكلفة بدل شرائها على الأمر
    productId: ref("product_id").references((): AnyPgColumn => products.id),
    warehouseId: ref("warehouse_id").references((): AnyPgColumn => warehouses.id),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
    unitPrice: money("unit_price").notNull(),
    amount: money("amount").notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    vatAmount: money("vat_amount").notNull().default("0"),
  },
  (t) => [
    index("maintenance_lines_order_idx").on(t.orderId),
    check("maintenance_lines_amounts", sql`${t.quantity} > 0 and ${t.unitPrice} >= 0 and ${t.amount} >= 0 and ${t.vatAmount} >= 0`),
  ],
);

// ───────────── الرواتب ─────────────

export const advanceStatus = pgEnum("advance_status", ["pending", "paid", "settled"]);
export const payrollStatus = pgEnum("payroll_status", ["draft", "approved", "paid"]);

// سلفة الموظف (ومنها مقدم العمولة للسائق): تُصرف من صندوق أو بنك، وتُستقطع أقساطاً في المسير
export const employeeAdvances = pgTable(
  "employee_advances",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    employeeId: ref("employee_id").notNull().references(() => employees.id),
    advanceDate: date("advance_date").notNull(),
    amount: money("amount").notNull(),
    installment: money("installment").notNull(),
    repaidAmount: money("repaid_amount").notNull().default("0"),
    cashAccountId: ref("cash_account_id").references(() => accounts.id),
    status: advanceStatus("status").notNull().default("pending"),
    notes: text("notes"),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    createdBy: ref("created_by").references(() => users.id),
    approvedBy: ref("approved_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("employee_advances_employee_idx").on(t.employeeId),
    check("employee_advances_amounts", sql`${t.amount} > 0 and ${t.installment} > 0 and ${t.installment} <= ${t.amount} and ${t.repaidAmount} between 0 and ${t.amount}`),
  ],
);

// مسير الشهر: مسودة ← معتمد (قيد الاستحقاق) ← مصروف (قيد الصرف من البنك)
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    // أول يوم في الشهر
    month: date("month").notNull().unique(),
    status: payrollStatus("status").notNull().default("draft"),
    paymentDate: date("payment_date"),
    bankAccountId: ref("bank_account_id").references(() => accounts.id),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    paymentEntryId: ref("payment_entry_id").references(() => journalEntries.id),
    notes: text("notes"),
    createdBy: ref("created_by").references(() => users.id),
    approvedBy: ref("approved_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [check("payroll_runs_month_start", sql`extract(day from ${t.month}) = 1`)],
);

export const payrollLines = pgTable(
  "payroll_lines",
  {
    id: id(),
    runId: ref("run_id").notNull().references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: ref("employee_id").notNull().references(() => employees.id),
    // السائق: تُحمَّل تكلفته على مركز تكلفة مركبته
    driverId: ref("driver_id").references(() => drivers.id),
    costCenterId: ref("cost_center_id").references(() => costCenters.id),
    basic: money("basic").notNull().default("0"),
    housing: money("housing").notNull().default("0"),
    otherAllowances: money("other_allowances").notNull().default("0"),
    absenceDays: numeric("absence_days", { precision: 5, scale: 2 }).notNull().default("0"),
    absenceDeduction: money("absence_deduction").notNull().default("0"),
    additions: money("additions").notNull().default("0"),
    deductions: money("deductions").notNull().default("0"),
    // للعرض فقط: العمولات قُيدت لحسابه عند اعتماد الشحنات
    commissions: money("commissions").notNull().default("0"),
    // للعرض فقط: المخالفات قُيدت على حسابه عند تسجيلها، ويخصمها المسير من الصافي
    violations: money("violations").notNull().default("0"),
    advanceDeduction: money("advance_deduction").notNull().default("0"),
    // من الموارد البشرية بعد اعتمادها: الحوافز تضاف، والجزاءات تُخصم وتُحتجز في 2116
    incentives: money("incentives").notNull().default("0"),
    penalties: money("penalties").notNull().default("0"),
    // أيام الإجازة بدون راتب وغياب الحضور في الشهر، تُضاف إلى أيام الغياب اليدوية
    leaveDays: numeric("leave_days", { precision: 5, scale: 2 }).notNull().default("0"),
    gosiEmployee: money("gosi_employee").notNull().default("0"),
    gosiEmployer: money("gosi_employer").notNull().default("0"),
    eosbAccrual: money("eosb_accrual").notNull().default("0"),
    net: money("net").notNull().default("0"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("payroll_lines_run_employee_uq").on(t.runId, t.employeeId),
    check(
      "payroll_lines_amounts",
      sql`${t.basic} >= 0 and ${t.housing} >= 0 and ${t.otherAllowances} >= 0 and ${t.absenceDays} >= 0 and ${t.additions} >= 0 and ${t.deductions} >= 0 and ${t.advanceDeduction} >= 0`,
    ),
  ],
);

// ───────────────────────── المخالفات المرورية ─────────────────────────

// على السائق: تُخصم من راتبه (مدين حساب رواتبه). على الشركة: مصروف على مركز تكلفة المركبة.
export const violationChargeTo = pgEnum("violation_charge_to", ["driver", "company"]);
// مسجلة (بقيدها) ← مسددة للجهة (بقيد السداد)
export const violationStatus = pgEnum("violation_status", ["posted", "paid"]);

export const trafficViolations = pgTable(
  "traffic_violations",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    violationDate: date("violation_date").notNull(),
    // رقم المخالفة لدى المرور، لمنع تسجيلها مرتين
    reference: varchar("reference", { length: 40 }).unique(),
    vehicleId: ref("vehicle_id").notNull().references(() => vehicles.id),
    // يُستنتج من سجل الإسناد في تاريخ المخالفة
    driverId: ref("driver_id").references(() => drivers.id),
    violationType: text("violation_type").notNull(),
    location: text("location"),
    amount: money("amount").notNull(),
    chargeTo: violationChargeTo("charge_to").notNull(),
    status: violationStatus("status").notNull().default("posted"),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    // المسير الذي خصمها من الراتب (للمخالفة على السائق)
    payrollRunId: ref("payroll_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
    paymentDate: date("payment_date"),
    cashAccountId: ref("cash_account_id").references(() => accounts.id),
    paymentEntryId: ref("payment_entry_id").references(() => journalEntries.id),
    notes: text("notes"),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("traffic_violations_vehicle_idx").on(t.vehicleId, t.violationDate),
    index("traffic_violations_driver_idx").on(t.driverId, t.violationDate),
    check("traffic_violations_amount", sql`${t.amount} > 0`),
    check("traffic_violations_driver", sql`${t.chargeTo} <> 'driver' or ${t.driverId} is not null`),
  ],
);

// ───────────────────────── بيانات المنشأة ─────────────────────────
// صف واحد فقط (id = 1): يظهر في رأس الفواتير الضريبية والتقارير المطبوعة
export const companyProfile = pgTable(
  "company_profile",
  {
    id: integer("id").primaryKey().default(1),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    vatNumber: varchar("vat_number", { length: 15 }),
    crNumber: varchar("cr_number", { length: 20 }),
    // العنوان الوطني (مطلوب في الفاتورة الإلكترونية)
    buildingNo: varchar("building_no", { length: 10 }),
    street: text("street"),
    district: text("district"),
    city: text("city"),
    postalCode: varchar("postal_code", { length: 10 }),
    additionalNo: varchar("additional_no", { length: 10 }),
    country: varchar("country", { length: 2 }).notNull().default("SA"),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 120 }),
    website: varchar("website", { length: 120 }),
    // الشعار مخزن كرابط بيانات (data:image/...) لأن الاستضافة بلا ملفات دائمة
    logo: text("logo"),
    updatedBy: ref("updated_by").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [check("company_profile_single", sql`${t.id} = 1`)],
);

// قالب الفاتورة المطبوعة (صف واحد)؛ الخيارات في JSON تُقرأ عبر normalizeTemplate
export const invoiceTemplate = pgTable(
  "invoice_template",
  {
    id: integer("id").primaryKey().default(1),
    options: jsonb("options").notNull().default({}),
    updatedBy: ref("updated_by").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [check("invoice_template_single", sql`${t.id} = 1`)],
);

// ───────────── الحسابات البنكية ─────────────

// بيانات البنك لحساب تفصيلي تحت 1102؛ الرصيد من القيود المرحّلة
export const bankAccounts = pgTable("bank_accounts", {
  id: id(),
  accountId: ref("account_id").notNull().unique().references(() => accounts.id),
  bankName: text("bank_name").notNull(),
  accountNumber: varchar("account_number", { length: 40 }),
  iban: varchar("iban", { length: 34 }),
  swift: varchar("swift", { length: 11 }),
  branch: text("branch"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

// ───────────── التسوية البنكية ─────────────

export const reconciliationStatus = pgEnum("reconciliation_status", ["draft", "completed"]);

/** مطابقة كشف البنك: رصيد الكشف في تاريخه مقابل حركات الحساب المؤشر عليها «ظهرت في الكشف». */
export const bankReconciliations = pgTable(
  "bank_reconciliations",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    accountId: ref("account_id").notNull().references(() => accounts.id),
    statementDate: date("statement_date").notNull(),
    // بعملة الحساب
    statementBalance: money("statement_balance").notNull(),
    status: reconciliationStatus("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
    completedBy: ref("completed_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("bank_reconciliations_account_idx").on(t.accountId, t.statementDate)],
);

/** سطر قيد ظهر في كشف البنك. السطر يُطابق مرة واحدة. */
export const bankReconciliationItems = pgTable("bank_reconciliation_items", {
  id: id(),
  reconciliationId: ref("reconciliation_id")
    .notNull()
    .references(() => bankReconciliations.id, { onDelete: "cascade" }),
  journalLineId: ref("journal_line_id")
    .notNull()
    .unique()
    .references(() => journalLines.id, { onDelete: "cascade" }),
});

// ───────────── الأصول الثابتة والإهلاك ─────────────

export const assetStatus = pgEnum("asset_status", ["active", "disposed"]);

// الأصل الثابت بالقسط الثابت: (التكلفة − الخردة) ÷ العمر بالأشهر، يبدأ من شهر الاقتناء
export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    nameAr: text("name_ar").notNull(),
    assetAccountId: ref("asset_account_id").notNull().references(() => accounts.id),
    accumulatedAccountId: ref("accumulated_account_id").notNull().references(() => accounts.id),
    expenseAccountId: ref("expense_account_id").notNull().references(() => accounts.id),
    costCenterId: ref("cost_center_id").references(() => costCenters.id),
    vehicleId: ref("vehicle_id").references(() => vehicles.id),
    acquisitionDate: date("acquisition_date").notNull(),
    // بداية الإهلاك (أول الشهر)؛ غالباً شهر الاقتناء
    depreciationStart: date("depreciation_start").notNull(),
    cost: money("cost").notNull(),
    salvageValue: money("salvage_value").notNull().default("0"),
    usefulLifeMonths: integer("useful_life_months").notNull(),
    // إهلاك سابق مُرحّل خارج النظام (عند إدخال أصل قديم)
    openingDepreciation: money("opening_depreciation").notNull().default("0"),
    // قيد الاقتناء إن سُجل من هنا (مدين الأصل / دائن الحساب المقابل)
    acquisitionEntryId: ref("acquisition_entry_id").references(() => journalEntries.id),
    status: assetStatus("status").notNull().default("active"),
    disposalDate: date("disposal_date"),
    notes: text("notes"),
    createdBy: ref("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("fixed_assets_amounts", sql`${t.cost} > 0 and ${t.salvageValue} >= 0 and ${t.salvageValue} < ${t.cost} and ${t.usefulLifeMonths} between 1 and 600 and ${t.openingDepreciation} >= 0`),
  ],
);

export const assetDepreciation = pgTable(
  "asset_depreciation",
  {
    id: id(),
    assetId: ref("asset_id").notNull().references(() => fixedAssets.id, { onDelete: "cascade" }),
    // آخر يوم في الشهر المهلَك
    periodEnd: date("period_end").notNull(),
    amount: money("amount").notNull(),
    entryId: ref("entry_id").notNull().references(() => journalEntries.id),
  },
  (t) => [uniqueIndex("asset_depreciation_period_uq").on(t.assetId, t.periodEnd), check("asset_depreciation_amount", sql`${t.amount} > 0`)],
);

// ───────────── المخزون وقطع الغيار ─────────────

// صنف مخزني (قطع غيار، إطارات، زيوت) يُتابع بالكمية والتكلفة، أو خدمة بلا مخزون
export const productKind = pgEnum("product_kind", ["stock", "service"]);

export const products = pgTable(
  "products",
  {
    id: id(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en"),
    kind: productKind("kind").notNull().default("stock"),
    category: text("category"),
    unit: varchar("unit", { length: 20 }).notNull().default("حبة"),
    barcode: varchar("barcode", { length: 60 }),
    purchasePrice: money("purchase_price").notNull().default("0"),
    salePrice: money("sale_price").notNull().default("0"),
    reorderLevel: numeric("reorder_level", { precision: 12, scale: 3 }).notNull().default("0"),
    // حساب المخزون للصنف المخزني، أو حساب المصروف الافتراضي للخدمة
    accountId: ref("account_id").notNull().references(() => accounts.id),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("products_name_idx").on(t.nameAr), check("products_prices", sql`${t.purchasePrice} >= 0 and ${t.salePrice} >= 0 and ${t.reorderLevel} >= 0`)],
);

export const warehouses = pgTable("warehouses", {
  id: id(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  nameAr: text("name_ar").notNull(),
  location: text("location"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

// مستند مخزني: تسوية (زيادة أو نقص)، تحويل بين مستودعين، أو جرد
export const stockDocKind = pgEnum("stock_doc_kind", ["adjustment", "transfer", "count"]);
export const stockDocStatus = pgEnum("stock_doc_status", ["draft", "posted"]);

export const stockDocs = pgTable(
  "stock_docs",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    kind: stockDocKind("kind").notNull(),
    docDate: date("doc_date").notNull(),
    warehouseId: ref("warehouse_id").notNull().references(() => warehouses.id),
    toWarehouseId: ref("to_warehouse_id").references(() => warehouses.id),
    // الحساب المقابل لفرق القيمة (التسوية والجرد)
    offsetAccountId: ref("offset_account_id").references(() => accounts.id),
    costCenterId: ref("cost_center_id").references(() => costCenters.id),
    reason: text("reason"),
    status: stockDocStatus("status").notNull().default("draft"),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    createdBy: ref("created_by").references(() => users.id),
    postedBy: ref("posted_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_docs_date_idx").on(t.docDate),
    check("stock_docs_transfer", sql`(${t.kind} = 'transfer') = (${t.toWarehouseId} is not null) and (${t.toWarehouseId} is null or ${t.toWarehouseId} <> ${t.warehouseId})`),
  ],
);

export const stockDocLines = pgTable(
  "stock_doc_lines",
  {
    id: id(),
    docId: ref("doc_id").notNull().references(() => stockDocs.id, { onDelete: "cascade" }),
    productId: ref("product_id").notNull().references(() => products.id),
    // التسوية: موجبة زيادة وسالبة نقص؛ التحويل: موجبة؛ الجرد: الفرق بعد الترحيل
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
    // الجرد: الرصيد في النظام عند الإنشاء والكمية المعدودة
    systemQty: numeric("system_qty", { precision: 12, scale: 3 }),
    countedQty: numeric("counted_qty", { precision: 12, scale: 3 }),
    unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull().default("0"),
  },
  (t) => [index("stock_doc_lines_doc_idx").on(t.docId)],
);

// حركة المخزون: الكمية موجبة دخولاً وسالبة خروجاً، والقيمة بالريال بالتكلفة
export const stockMoves = pgTable(
  "stock_moves",
  {
    id: id(),
    productId: ref("product_id").notNull().references(() => products.id),
    warehouseId: ref("warehouse_id").notNull().references(() => warehouses.id),
    moveDate: date("move_date").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    value: money("value").notNull(),
    // purchase_invoice | maintenance_order | stock_doc
    sourceType: varchar("source_type", { length: 30 }).notNull(),
    sourceId: ref("source_id").notNull(),
    description: text("description"),
    createdAt: createdAt(),
  },
  (t) => [
    index("stock_moves_product_idx").on(t.productId, t.warehouseId),
    index("stock_moves_source_idx").on(t.sourceType, t.sourceId),
    check("stock_moves_qty", sql`${t.quantity} <> 0`),
  ],
);

// ───────────────────────── الموارد البشرية ─────────────────────────

// إعدادات صف واحد (id = 1)
export const hrSettings = pgTable(
  "hr_settings",
  {
    id: smallint("id").primaryKey().default(1),
    // نقاط تُخصم من التقييم الشهري عن كل إنذار
    warningPoints: smallint("warning_points").notNull().default(2),
    // مخالفة السائق المرورية تُحسب إنذاراً في تقييم شهرها
    violationsAsWarnings: boolean("violations_as_warnings").notNull().default(true),
    // الترقية تظهر مستحقة بعد عدد أشهر متتالية بدرجة لا تقل عن الحد
    promotionScore: smallint("promotion_score").notNull().default(85),
    promotionMonths: smallint("promotion_months").notNull().default(3),
    // مقدم العمولة من تطبيق السائق: أيام الطلب في الشهر والسقف لكل فئة
    advanceOpenDay: smallint("advance_open_day").notNull().default(1),
    advanceCloseDay: smallint("advance_close_day").notNull().default(20),
    advanceCapDomestic: money("advance_cap_domestic").notNull().default("1000"),
    advanceCapInternational: money("advance_cap_international").notNull().default("2000"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("hr_settings_singleton", sql`${t.id} = 1`),
    check("hr_settings_days", sql`${t.advanceOpenDay} between 1 and 31 and ${t.advanceCloseDay} between ${t.advanceOpenDay} and 31`),
  ],
);

export const evaluationCriteria = pgTable(
  "evaluation_criteria",
  {
    id: id(),
    nameAr: text("name_ar").notNull(),
    weight: smallint("weight").notNull(),
    active: boolean("active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [check("evaluation_criteria_weight", sql`${t.weight} between 1 and 10`)],
);

// العهدة النقدية لها قيد (مدين عهدة الموظف، دائن الصندوق)، والعينية سجل رقابي بلا قيد
export const custodyKind = pgEnum("custody_kind", ["cash", "in_kind"]);
export const custodyStatus = pgEnum("custody_status", ["draft", "approved", "delivered", "settled", "returned", "cancelled"]);

export const custodyDocs = pgTable(
  "custody_docs",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    kind: custodyKind("kind").notNull(),
    employeeId: ref("employee_id").notNull().references(() => employees.id),
    docDate: date("doc_date").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
    // مبلغ العهدة النقدية، أو قيمة العينية للرقابة
    amount: money("amount").notNull().default("0"),
    serialNo: varchar("serial_no", { length: 60 }),
    // عهدة قائمة قبل بدء العمل على البرنامج: رصيدها في القيد الافتتاحي فلا قيد لها هنا
    isOpening: boolean("is_opening").notNull().default(false),
    status: custodyStatus("status").notNull().default("draft"),
    cashAccountId: ref("cash_account_id").references(() => accounts.id),
    journalEntryId: ref("journal_entry_id").references(() => journalEntries.id),
    closeDate: date("close_date"),
    returnedAmount: money("returned_amount").notNull().default("0"),
    closeEntryId: ref("close_entry_id").references(() => journalEntries.id),
    closeNotes: text("close_notes"),
    notes: text("notes"),
    createdBy: ref("created_by").references(() => users.id),
    approvedBy: ref("approved_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("custody_docs_employee_idx").on(t.employeeId, t.status),
    check("custody_docs_amounts", sql`${t.amount} >= 0 and ${t.quantity} > 0 and ${t.returnedAmount} between 0 and ${t.amount} and (${t.kind} <> 'cash' or ${t.amount} > 0)`),
  ],
);

// الإنذار يخصم نقاطاً من التقييم، والجزاء يُخصم من الراتب، والحافز يضاف إليه
export const hrActionKind = pgEnum("hr_action_kind", ["warning", "penalty", "incentive"]);
export const hrActionStatus = pgEnum("hr_action_status", ["draft", "approved", "cancelled"]);

export const hrActions = pgTable(
  "hr_actions",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    kind: hrActionKind("kind").notNull(),
    employeeId: ref("employee_id").notNull().references(() => employees.id),
    actionDate: date("action_date").notNull(),
    amount: money("amount").notNull().default("0"),
    points: smallint("points").notNull().default(0),
    reason: text("reason").notNull(),
    status: hrActionStatus("status").notNull().default("draft"),
    // المسير الذي أضافه أو خصمه (للجزاء والحافز)
    payrollRunId: ref("payroll_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
    createdBy: ref("created_by").references(() => users.id),
    approvedBy: ref("approved_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("hr_actions_employee_idx").on(t.employeeId, t.actionDate),
    check("hr_actions_values", sql`${t.points} >= 0 and (${t.kind} = 'warning' or ${t.amount} > 0)`),
  ],
);

export const leaveTypes = pgTable("leave_types", {
  id: id(),
  nameAr: text("name_ar").notNull().unique(),
  paid: boolean("paid").notNull().default(true),
  // الإجازة السنوية: 21 يوماً، و30 بعد خمس سنوات خدمة (نظام العمل)
  isAnnual: boolean("is_annual").notNull().default(false),
  // رصيد سنوي ثابت لغير السنوية؛ فارغ = بلا رصيد
  yearlyDays: smallint("yearly_days"),
  active: boolean("active").notNull().default(true),
});

export const leaveStatus = pgEnum("leave_status", ["pending", "approved", "rejected", "cancelled"]);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    employeeId: ref("employee_id").notNull().references(() => employees.id),
    typeId: ref("type_id").notNull().references(() => leaveTypes.id),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    days: smallint("days").notNull(),
    reason: text("reason"),
    status: leaveStatus("status").notNull().default("pending"),
    rejectReason: text("reject_reason"),
    createdBy: ref("created_by").references(() => users.id),
    approvedBy: ref("approved_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("leave_requests_employee_idx").on(t.employeeId, t.fromDate),
    check("leave_requests_dates", sql`${t.toDate} >= ${t.fromDate} and ${t.days} > 0`),
  ],
);

// حضور الإداريين فقط؛ السائق حضوره رحلاته
export const attendanceStatus = pgEnum("attendance_status", ["present", "absent", "late", "leave"]);

export const attendance = pgTable(
  "attendance",
  {
    id: id(),
    employeeId: ref("employee_id").notNull().references(() => employees.id),
    day: date("day").notNull(),
    status: attendanceStatus("status").notNull(),
    lateMinutes: smallint("late_minutes").notNull().default(0),
    notes: text("notes"),
    createdBy: ref("created_by").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("attendance_employee_day_uq").on(t.employeeId, t.day), check("attendance_late", sql`${t.lateMinutes} >= 0`)],
);

export const evaluationStatus = pgEnum("evaluation_status", ["draft", "approved"]);

// التقييم الشهري: درجة المعايير الموزونة ناقص نقاط الإنذارات (والمخالفات إن فُعّلت)
export const evaluations = pgTable(
  "evaluations",
  {
    id: id(),
    employeeId: ref("employee_id").notNull().references(() => employees.id),
    // أول يوم في الشهر
    month: date("month").notNull(),
    // { [معرّف المعيار]: درجة من 0 إلى 10 }
    scores: jsonb("scores").$type<Record<string, number>>().notNull().default({}),
    baseScore: numeric("base_score", { precision: 5, scale: 2 }).notNull().default("0"),
    warnings: smallint("warnings").notNull().default(0),
    violations: smallint("violations").notNull().default(0),
    deduction: numeric("deduction", { precision: 5, scale: 2 }).notNull().default("0"),
    finalScore: numeric("final_score", { precision: 5, scale: 2 }).notNull().default("0"),
    status: evaluationStatus("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: ref("created_by").references(() => users.id),
    approvedBy: ref("approved_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("evaluations_employee_month_uq").on(t.employeeId, t.month), check("evaluations_month_start", sql`extract(day from ${t.month}) = 1`)],
);

// الترقية تُطبق فوراً على المسمى والراتب الأساسي، ويبقى سجلها
export const promotions = pgTable("promotions", {
  id: id(),
  employeeId: ref("employee_id").notNull().references(() => employees.id),
  effectiveDate: date("effective_date").notNull(),
  fromTitle: text("from_title"),
  toTitle: text("to_title"),
  fromBasic: money("from_basic").notNull(),
  toBasic: money("to_basic").notNull(),
  reason: text("reason"),
  createdBy: ref("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const commissionAdvanceStatus = pgEnum("commission_advance_status", ["pending", "approved", "rejected"]);

// طلب مقدم العمولة من تطبيق السائق؛ الاعتماد ينشئ سلفة تُستقطع كاملة في المسير القادم
export const commissionAdvanceRequests = pgTable(
  "commission_advance_requests",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
    driverId: ref("driver_id").notNull().references(() => drivers.id),
    requestDate: date("request_date").notNull(),
    amount: money("amount").notNull(),
    notes: text("notes"),
    status: commissionAdvanceStatus("status").notNull().default("pending"),
    advanceId: ref("advance_id").references(() => employeeAdvances.id),
    rejectReason: text("reject_reason"),
    decidedBy: ref("decided_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("commission_advance_driver_idx").on(t.driverId, t.requestDate), check("commission_advance_amount", sql`${t.amount} > 0`)],
);

// ───────────── المرفقات (صور تطبيق السائق) ─────────────

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// صورة مضغوطة مرتبطة بسجل: إثبات التسليم أو العداد أو فاتورة الوقود أو إيصال مصروف
export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    entity: varchar("entity", { length: 40 }).notNull(),
    entityId: ref("entity_id").notNull(),
    kind: varchar("kind", { length: 30 }).notNull(),
    mime: varchar("mime", { length: 40 }).notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdBy: ref("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_entity_idx").on(t.entity, t.entityId)],
);

// عمليات تطبيق السائق المرسلة (لمنع تكرار ما حُفظ دون إنترنت ثم أُعيد إرساله)
export const clientOps = pgTable("client_ops", {
  opId: varchar("op_id", { length: 40 }).primaryKey(),
  createdAt: createdAt(),
});
