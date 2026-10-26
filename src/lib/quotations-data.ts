// ثوابت عروض الأسعار المشتركة بين الخادم والمتصفح (الحالات، نوع الشحن والضريبة، الترتيب).

import { PERIODS, periodRange, type Period } from "@/lib/doc-filters";

// عرض سعر للعميل: سطور نقل (مسار أو وصف حر) بكمية وسعر، يُرسل ويُطبع، وعند القبول يتحول لفاتورة مسودة.
export const QUOTE_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  sent: { label: "مُرسل", tone: "blue" },
  accepted: { label: "مقبول", tone: "green" },
  rejected: { label: "مرفوض", tone: "red" },
  cancelled: { label: "ملغى", tone: "red" },
} as const;
export type QuoteStatus = keyof typeof QUOTE_STATUS;

// نوع الشحن يحدد الضريبة: الدولي (خارج السعودية) صفري، والداخلي 15%
export const SHIPPING_TYPES = {
  international: { label: "دولي (خارج السعودية)", short: "دولي", vat: 0, tax: "ضريبة صفرية" },
  domestic: { label: "داخلي (داخل السعودية)", short: "داخلي", vat: 15, tax: "ضريبة 15%" },
} as const;
export type ShippingType = keyof typeof SHIPPING_TYPES;
export const isShippingType = (v: unknown): v is ShippingType => v === "international" || v === "domestic";

export const QUOTE_SORTS = {
  date_desc: "الأحدث أولاً",
  date_asc: "الأقدم أولاً",
  amount_desc: "الأعلى مبلغاً",
  amount_asc: "الأقل مبلغاً",
  number_desc: "الرقم تنازلياً",
  party_asc: "حسب العميل",
} as const;



export interface QuoteListParams {
  q?: string;
  status?: string;
  period?: string;
  sort?: string;
  view?: string;
  open?: string;
}

/** فلتر القائمة من رابط الصفحة (ومثله رابط التصدير)، فتبقى القائمة قابلة للمشاركة والرجوع. */
export function parseQuoteFilter(sp: QuoteListParams, today: string) {
  const period: Period = sp.period && sp.period in PERIODS ? (sp.period as Period) : "all";
  return {
    q: sp.q?.trim() || undefined,
    status: sp.status && sp.status in QUOTE_STATUS ? sp.status : undefined,
    ...periodRange(period, today),
    sort: sp.sort && sp.sort in QUOTE_SORTS ? (sp.sort as keyof typeof QUOTE_SORTS) : "date_desc",
    today,
  };
}
