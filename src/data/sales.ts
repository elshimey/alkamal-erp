export const INVOICE_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  issued: { label: "مُصدرة", tone: "blue" },
} as const;

/** حالة السداد تُستنتج من المبلغ المخصص. */
export function paymentState(total: number, paid: number) {
  if (paid <= 0) return { label: "غير مسددة", tone: "amber" } as const;
  if (paid < total) return { label: "مسددة جزئياً", tone: "blue" } as const;
  return { label: "مسددة", tone: "green" } as const;
}

export const ZATCA_STATUS = {
  not_sent: "لم تُرسل للهيئة",
  accepted: "معتمدة من الهيئة",
  rejected: "مرفوضة من الهيئة",
} as const;

export const PAYMENT_METHODS = {
  cash: "نقد",
  transfer: "تحويل",
  cheque: "شيك",
  card: "شبكة",
} as const;

export const RECEIPT_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  posted: { label: "مرحّل", tone: "green" },
} as const;

// حسابات قيود المبيعات (خريطة القيود التلقائية)
export const SALES_ACCOUNTS = {
  receivable: "1103",
  domesticRevenue: "4101",
  internationalRevenue: "4102",
  rechargedExpenses: "4104",
  outputVat: "2109",
  customerAdvances: "2112",
  fxDifferences: "7103",
} as const;

export const RECEIPT_KINDS = {
  invoice_payment: { label: "دفعة عن فواتير", short: "دفعة فواتير", tone: "green" },
  advance: { label: "دفعة مقدمة", short: "دفعة مقدمة", tone: "blue" },
  refund: { label: "سند استرداد", short: "استرداد", tone: "amber" },
} as const;

// الإشعارات الدائنة والمدينة للمبيعات والمشتريات
export const NOTE_KINDS = {
  sales_credit: { label: "إشعار دائن", en: "Credit Note", short: "دائن", prefix: "CN", side: "sales", tone: "green", reduces: true },
  sales_debit: { label: "إشعار مدين", en: "Debit Note", short: "مدين", prefix: "DN", side: "sales", tone: "amber", reduces: false },
  purchase_debit: { label: "إشعار مدين للمورد", en: "Debit Note", short: "مدين", prefix: "PDN", side: "purchase", tone: "green", reduces: true },
  purchase_credit: { label: "إشعار دائن من المورد", en: "Credit Note", short: "دائن", prefix: "PCN", side: "purchase", tone: "amber", reduces: false },
} as const;
export type NoteKind = keyof typeof NOTE_KINDS;
export const NOTE_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  posted: { label: "مرحّل", tone: "blue" },
} as const;

export const NOTE_SIDES = {
  sales: { title: "إشعارات العملاء", party: "العميل", entity: "sales_invoices", invoices: "/invoices", kinds: ["sales_credit", "sales_debit"] },
  purchase: { title: "إشعارات الموردين", party: "المورد", entity: "purchase_invoices", invoices: "/purchases", kinds: ["purchase_debit", "purchase_credit"] },
} as const;
export type NoteSide = keyof typeof NOTE_SIDES;
