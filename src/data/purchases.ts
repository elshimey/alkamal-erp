// المشتريات والمصروفات: حالات المستندات وحسابات قيودها

export const PURCHASE_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  posted: { label: "مرحّلة", tone: "blue" },
} as const;

export const EXPENSE_STATUS = {
  pending: { label: "بانتظار الاعتماد", tone: "amber" },
  approved: { label: "معتمد", tone: "green" },
  rejected: { label: "مرفوض", tone: "red" },
} as const;

export const EXPENSE_PAYERS = {
  driver_custody: "عهدة السائق",
  cash: "صندوق / بنك",
} as const;

export const PAYMENT_KINDS = {
  supplier: "سداد لمورد",
  custody: "صرف عهدة لسائق",
} as const;

// حساب الذمة حسب دور الجهة؛ عند تعدد الأدوار يؤخذ الأول بهذا الترتيب
export const PAYABLE_BY_ROLE = [
  { role: "carrier", code: "2102", label: "ناقل خارجي" },
  { role: "fuel_station", code: "2103", label: "محطة وقود" },
  { role: "workshop", code: "2104", label: "ورشة" },
  { role: "customs_broker", code: "2105", label: "مخلص جمركي" },
  { role: "supplier", code: "2101", label: "مورد" },
] as const;
export type SupplierRole = (typeof PAYABLE_BY_ROLE)[number]["role"];
export const SUPPLIER_ROLES = PAYABLE_BY_ROLE.map((p) => p.role) as SupplierRole[];

export const PURCHASE_ACCOUNTS = { inputVat: "1108", fxDifferences: "7103" } as const;

// الحسابات المسموحة في سطور المشتريات والمصروفات: التكاليف والمصروفات، والمخزون والمدفوع مقدماً والأصول
export const EXPENSE_ACCOUNT_PREFIXES = ["5", "6", "1109", "1110", "12"] as const;
export const isExpenseAccount = (code: string) => EXPENSE_ACCOUNT_PREFIXES.some((p) => code.startsWith(p));
