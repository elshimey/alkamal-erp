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
  not_sent: "لم تُرسل للزكاة",
  accepted: "مقبولة",
  rejected: "مرفوضة",
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
} as const;
