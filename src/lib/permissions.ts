// مصفوفة الصلاحيات (الكيان × الإجراء × النطاق) — البند 7 في نموذج البيانات.
// الوحدات التي لم تُبنَ بعد موجودة في المصفوفة من الآن حتى تُضبط الأدوار مرة واحدة.

export const ACTIONS = {
  view: "عرض",
  create: "إنشاء",
  update: "تعديل",
  approve: "اعتماد",
  revert: "إرجاع لمسودة",
  delete: "حذف",
  export: "تصدير",
  import: "استيراد",
} as const;
export type Action = keyof typeof ACTIONS;
export const ALL_ACTIONS = Object.keys(ACTIONS) as Action[];

export const MODULES = {
  system: "الإعدادات والمستخدمون",
  fleet: "الأسطول",
  operations: "التشغيل",
  maintenance: "الصيانة",
  sales: "المبيعات",
  purchases: "المشتريات والمصاريف",
  accounting: "المحاسبة",
  payroll: "الموظفون والرواتب",
  reports: "التقارير",
} as const;
export type Module = keyof typeof MODULES;

export const ENTITIES = {
  settings: { label: "الإعدادات العامة", module: "system" },
  users: { label: "المستخدمون", module: "system" },
  roles: { label: "الأدوار والصلاحيات", module: "system" },
  deletion_log: { label: "سجل المحذوفات", module: "system" },
  parties: { label: "جهات الاتصال", module: "sales" },
  vehicles: { label: "المركبات", module: "fleet" },
  drivers: { label: "السائقون", module: "fleet" },
  fleet_documents: { label: "سجل الوثائق", module: "fleet" },
  violations: { label: "المخالفات", module: "fleet" },
  routes: { label: "المواقع والمسارات", module: "operations" },
  contracts: { label: "العقود والأسعار", module: "operations" },
  waybills: { label: "الشحنات", module: "operations" },
  maintenance: { label: "أوامر الصيانة وطلبات العطل", module: "maintenance" },
  sales_invoices: { label: "فواتير المبيعات", module: "sales" },
  receipts: { label: "سندات القبض", module: "sales" },
  purchase_invoices: { label: "فواتير الموردين", module: "purchases" },
  expenses: { label: "المصروفات", module: "purchases" },
  payments: { label: "سندات الصرف", module: "purchases" },
  fuel_cards: { label: "بطاقات الوقود", module: "purchases" },
  inventory: { label: "المخزون والأصناف", module: "purchases" },
  accounts: { label: "شجرة الحسابات", module: "accounting" },
  cost_centers: { label: "مراكز التكلفة", module: "accounting" },
  journal_entries: { label: "القيود", module: "accounting" },
  fiscal_periods: { label: "الفترات المحاسبية", module: "accounting" },
  fixed_assets: { label: "الأصول والإهلاك", module: "accounting" },
  employees: { label: "الموظفون", module: "payroll" },
  payroll: { label: "مسيرات الرواتب والسلف ومقدم العمولة", module: "payroll" },
  custody: { label: "العُهد النقدية والعينية", module: "payroll" },
  hr_actions: { label: "الإنذارات والجزاءات والحوافز", module: "payroll" },
  leaves: { label: "الإجازات والحضور", module: "payroll" },
  evaluations: { label: "التقييم والترقيات", module: "payroll" },
  financial_reports: { label: "التقارير المالية", module: "reports" },
  operational_reports: { label: "التقارير التشغيلية واللوحة", module: "reports" },
} as const satisfies Record<string, { label: string; module: Module }>;
export type Entity = keyof typeof ENTITIES;
export const ALL_ENTITIES = Object.keys(ENTITIES) as Entity[];

// صلاحيتان خاصتان خارج المصفوفة
export const SPECIAL = {
  view_prices: "رؤية الأسعار",
  override_controls: "تجاوز الضوابط (الحد الائتماني، العقد، المستندات) مع سبب",
} as const;
export type Special = keyof typeof SPECIAL;
export const SPECIAL_ENTITY = "special";

export type Scope = "own" | "all";

export interface PermissionRow {
  entity: string;
  action: string;
  scope: Scope;
}

export interface PermissionSet {
  isAdmin: boolean;
  rows: PermissionRow[];
}

/** هل يملك المستخدم الإجراء؟ يُرجع النطاق الأوسع المتاح أو null. */
export function scopeFor(perms: PermissionSet, entity: Entity | typeof SPECIAL_ENTITY, action: string): Scope | null {
  if (perms.isAdmin) return "all";
  let best: Scope | null = null;
  for (const r of perms.rows) {
    if (r.entity !== entity || r.action !== action) continue;
    if (r.scope === "all") return "all";
    best = "own";
  }
  return best;
}

export function can(perms: PermissionSet, entity: Entity, action: Action): boolean {
  return scopeFor(perms, entity, action) !== null;
}

export function hasSpecial(perms: PermissionSet, special: Special): boolean {
  return scopeFor(perms, SPECIAL_ENTITY, special) !== null;
}

// ───────────── الأدوار الأساسية (تأتي مع النظام ولا تُحذف) ─────────────

export type CoreRoleKey = "admin" | "manager" | "accountant" | "driver";

export interface CoreRole {
  key: CoreRoleKey;
  nameAr: string;
  description: string;
  permissions: PermissionRow[];
}

const grant = (entities: Entity[], actions: Action[], scope: Scope = "all"): PermissionRow[] =>
  entities.flatMap((entity) => actions.map((action) => ({ entity, action, scope })));

const entitiesOf = (...modules: Module[]) => ALL_ENTITIES.filter((e) => modules.includes(ENTITIES[e].module));

const special = (...keys: Special[]): PermissionRow[] =>
  keys.map((action) => ({ entity: SPECIAL_ENTITY, action, scope: "all" as const }));

const FINANCE_WORK: Action[] = ["view", "create", "update", "approve", "revert", "export", "import"];

export const CORE_ROLES: CoreRole[] = [
  {
    key: "admin",
    nameAr: "مدير النظام",
    description: "كل الصلاحيات، والإعدادات، وإدارة المستخدمين والأدوار، والحذف، وفتح الفترات المقفلة",
    permissions: [], // يتجاوز المصفوفة بالكامل
  },
  {
    key: "manager",
    nameAr: "المدير",
    description: "عرض كل الوحدات والتقارير واللوحة، واعتماد ما يتجاوز حدود الآخرين، بلا إعدادات ولا إدارة مستخدمين",
    permissions: [
      ...grant(
        ALL_ENTITIES.filter((e) => ENTITIES[e].module !== "system"),
        ["view", "approve", "export"],
      ),
      ...special("view_prices", "override_controls"),
    ],
  },
  {
    key: "accountant",
    nameAr: "المحاسب",
    description:
      "المبيعات، المشتريات والمصاريف، المحاسبة، الرواتب، المخالفات المرورية، التقارير المالية؛ الترحيل والإرجاع لمسودة وإقفال الفترة. عرض التشغيل والأسطول دون تعديل",
    permissions: [
      ...grant(entitiesOf("sales", "purchases", "accounting", "payroll"), FINANCE_WORK),
      // المخالفات لها قيد عند التسجيل والسداد وتُخصم في الرواتب، فيديرها المحاسب
      ...grant(["violations"], FINANCE_WORK),
      ...grant(["financial_reports"], ["view", "export"]),
      ...grant(entitiesOf("fleet", "operations", "maintenance").filter((e) => e !== "violations"), ["view"]),
      ...grant(["operational_reports"], ["view"]),
      ...special("view_prices"),
    ],
  },
  {
    key: "driver",
    nameAr: "السائق",
    description: "تطبيق السائق فقط: شحناته ومراحلها وديزلها ومصاريفه، بلاغ عطل، رصيد عهدته وعمولته. لا يرى الأسعار",
    permissions: [
      ...grant(["waybills", "expenses"], ["view", "create", "update"], "own"),
      ...grant(["maintenance"], ["view", "create"], "own"),
    ],
  },
];
