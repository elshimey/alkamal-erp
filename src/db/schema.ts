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
// أبعاد البوليصة والعقد والمسار تُضاف مع وحدة التشغيل.
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
  },
  (t) => [
    uniqueIndex("journal_lines_entry_line_uq").on(t.entryId, t.lineNo),
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
