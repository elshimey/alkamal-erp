// بنية قاعدة البيانات: الأساس المشترك + المحاسبة + المركبات والمستخدمون.
// المرجع: نموذج-البيانات-والوحدات.md (الإصدار الثاني) وشجرة-الحسابات.md.
// الوحدات التالية (التشغيل، المبيعات، المشتريات، الرواتب...) تضيف جداولها بترحيلات لاحقة.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
// الأبعاد: جهة الاتصال، مركز التكلفة (المركبة)، السائق، البوليصة.
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
  allowances: money("allowances").notNull().default("0"),
  bankName: text("bank_name"),
  iban: varchar("iban", { length: 34 }),
  // حساب الرواتب المستحقة الخاص به (فرعي تحت 2107)، وإليه تُقيد العمولات والخصومات
  payableAccountId: ref("payable_account_id").unique().references(() => accounts.id),
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
    // العمولة الافتراضية للسائق، وتُعدَّل على البوليصة قبل الاعتماد
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

// أنواع الرسوم الإضافية على البوليصة (انتظار، تحميل، تخليص، مبيت...)
export const chargeTypes = pgTable("charge_types", {
  id: id(),
  nameAr: text("name_ar").notNull().unique(),
  revenueAccountId: ref("revenue_account_id").references(() => accounts.id),
  costAccountId: ref("cost_account_id").references(() => accounts.id),
  isActive: boolean("is_active").notNull().default(true),
});

// ───────────────────────── البوليصة (الرحلة) ─────────────────────────

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

// مصاريف الحدود والطريق على البوليصة؛ ما يكون على العميل يُسحب للفاتورة كرسوم
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

export const invoiceLineKind = pgEnum("invoice_line_kind", ["waybill", "expense"]);

// سطر لكل بوليصة (والبوليصة لا تُفوتر مرتين)، أو مصروف محمّل على العميل
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
    amount: money("amount").notNull(),
    taxCodeId: ref("tax_code_id").references(() => taxCodes.id),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    vatAmount: money("vat_amount").notNull().default("0"),
    accountId: ref("account_id").notNull().references(() => accounts.id),
    // مركز التكلفة = مركبة البوليصة (أو مركز الناقلين الخارجيين)
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
      end`,
    ),
    check("sales_invoice_lines_amounts", sql`${t.amount} >= 0 and ${t.vatAmount} >= 0`),
  ],
);

export const paymentMethod = pgEnum("payment_method", ["cash", "transfer", "cheque", "card"]);
export const receiptStatus = pgEnum("receipt_status", ["draft", "posted"]);

export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    number: varchar("number", { length: 30 }).notNull().unique(),
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
  },
  (t) => [
    primaryKey({ columns: [t.receiptId, t.invoiceId] }),
    index("receipt_allocations_invoice_idx").on(t.invoiceId),
    check("receipt_allocations_positive", sql`${t.amount} > 0`),
  ],
);
