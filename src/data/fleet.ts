export const DOCUMENT_TYPES = {
  registration: "استمارة",
  periodic_inspection: "فحص دوري",
  operating_card: "كرت تشغيل",
  insurance: "تأمين",
  authorization: "تفويض",
  license: "رخصة قيادة",
  residency: "إقامة",
  other: "أخرى",
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

// تنبيه الوثائق قبل انتهائها بهذا العدد من الأيام
export const EXPIRY_ALERT_DAYS = 30;
