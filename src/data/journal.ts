// مصادر القيود الآلية: اسم المستند ورابط فتحه
export const ENTRY_SOURCES: Record<string, { label: string; href?: (id: number) => string }> = {
  sales_invoice: { label: "فاتورة مبيعات", href: (id) => `/invoices?open=${id}` },
  receipt: { label: "سند قبض", href: (id) => `/receipts?open=${id}` },
  adjustment_note: { label: "إشعار دائن/مدين" },
  purchase_invoice: { label: "فاتورة مورد", href: (id) => `/purchases?open=${id}` },
  expense: { label: "مصروف", href: () => "/expenses" },
  payment: { label: "سند صرف", href: () => "/payments" },
  waybill: { label: "بوليصة", href: (id) => `/waybills/${id}` },
  maintenance_order: { label: "أمر صيانة", href: (id) => `/maintenance/${id}` },
  payroll_run: { label: "مسير رواتب", href: (id) => `/payroll/${id}` },
  payroll_payment: { label: "صرف رواتب", href: (id) => `/payroll/${id}` },
  employee_advance: { label: "سلفة موظف", href: () => "/payroll/advances" },
  traffic_violation: { label: "مخالفة مرورية", href: (id) => `/violations?open=${id}` },
  violation_payment: { label: "سداد مخالفة", href: () => "/violations" },
  fixed_asset: { label: "اقتناء أصل", href: (id) => `/fixed-assets?open=${id}` },
  depreciation: { label: "إهلاك شهري", href: () => "/fixed-assets" },
  custody: { label: "عهدة موظف", href: (id) => `/hr/custody?open=${id}` },
  custody_close: { label: "تسوية عهدة", href: (id) => `/hr/custody?open=${id}` },
};

export const ENTRY_KINDS = { manual: "قيود يدوية", auto: "قيود آلية من المستندات", draft: "مسودات" } as const;
export const ENTRY_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  pending: { label: "بانتظار الاعتماد", tone: "amber" },
  posted: { label: "مرحّل", tone: "blue" },
} as const;
