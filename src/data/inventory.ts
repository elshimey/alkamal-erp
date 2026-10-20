export const STOCK_DOC_KINDS = {
  adjustment: { label: "تسوية مخزون", hint: "زيادة أو نقص (تالف، فقد، رصيد افتتاحي) مقابل حساب تختاره" },
  transfer: { label: "تحويل بين مستودعين", hint: "ينقل الكمية بتكلفتها دون قيد" },
  count: { label: "جرد", hint: "يُنشأ بأرصدة النظام، تُدخل الكميات المعدودة ثم يُرحّل الفرق" },
} as const;
export type StockDocKind = keyof typeof STOCK_DOC_KINDS;
