// قالب الفاتورة المطبوعة: الشكل واللون واللغة وما يظهر فيها. وحدة نقية تعمل في الخادم والمتصفح
// (المعاينة المباشرة في الإعدادات)، والحفظ في جدول invoice_template.

export const TEMPLATE_LAYOUTS = {
  classic: { label: "كلاسيكي", hint: "رأس أبيض وخط فاصل، مناسب للطباعة" },
  band: { label: "شريط ملون", hint: "رأس بلون الهوية واسم المنشأة بارز" },
  minimal: { label: "بسيط", hint: "أقل ألواناً وحدوداً، يوفر الحبر" },
} as const;

export const TEMPLATE_ACCENTS = {
  road: { label: "أصفر الطريق", main: "#e9a100", dark: "#1b2126" },
  asphalt: { label: "أسفلت", main: "#5b6770", dark: "#232b31" },
  navy: { label: "أزرق", main: "#2563eb", dark: "#172554" },
  green: { label: "أخضر", main: "#16a34a", dark: "#14532d" },
  maroon: { label: "عنابي", main: "#be123c", dark: "#4c0519" },
  teal: { label: "فيروزي", main: "#0d9488", dark: "#134e4a" },
} as const;

export type TemplateLayout = keyof typeof TEMPLATE_LAYOUTS;
export type TemplateAccent = keyof typeof TEMPLATE_ACCENTS;

export interface InvoiceTemplate {
  layout: TemplateLayout;
  accent: TemplateAccent;
  language: "bilingual" | "ar";
  showLogo: boolean;
  showQr: boolean;
  showCustomerIds: boolean;
  showRoadLine: boolean;
  showBank: boolean;
  bankName: string;
  accountName: string;
  iban: string;
  terms: string;
  footer: string;
}

export const DEFAULT_TEMPLATE: InvoiceTemplate = {
  layout: "classic",
  accent: "road",
  language: "bilingual",
  showLogo: true,
  showQr: true,
  showCustomerIds: true,
  showRoadLine: true,
  showBank: false,
  bankName: "",
  accountName: "",
  iban: "",
  terms: "",
  footer: "شكراً لثقتكم بنا",
};

const TEXT_MAX = 600;

/** يدمج المحفوظ مع الافتراضي ويتجاهل ما لا يُعرف، فلا يكسر قالب قديم أو تالف الطباعة. */
export function normalizeTemplate(raw: unknown): InvoiceTemplate {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof InvoiceTemplate) => (typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_TEMPLATE[k] as boolean));
  const text = (k: keyof InvoiceTemplate) => (typeof r[k] === "string" ? (r[k] as string).trim().slice(0, TEXT_MAX) : (DEFAULT_TEMPLATE[k] as string));
  return {
    layout: typeof r.layout === "string" && r.layout in TEMPLATE_LAYOUTS ? (r.layout as TemplateLayout) : DEFAULT_TEMPLATE.layout,
    accent: typeof r.accent === "string" && r.accent in TEMPLATE_ACCENTS ? (r.accent as TemplateAccent) : DEFAULT_TEMPLATE.accent,
    language: r.language === "ar" ? "ar" : "bilingual",
    showLogo: bool("showLogo"),
    showQr: bool("showQr"),
    showCustomerIds: bool("showCustomerIds"),
    showRoadLine: bool("showRoadLine"),
    showBank: bool("showBank"),
    bankName: text("bankName"),
    accountName: text("accountName"),
    iban: text("iban").replace(/\s/g, "").toUpperCase(),
    terms: text("terms"),
    footer: text("footer"),
  };
}

/** تحقق قبل الحفظ: الآيبان السعودي SA و22 رقماً، وبيانات البنك كاملة إن طُلب إظهارها. */
export function validateTemplate(t: InvoiceTemplate) {
  if (t.iban && !/^SA\d{22}$/.test(t.iban)) throw new Error("الآيبان يبدأ بـ SA ويليه 22 رقماً");
  if (t.showBank && (!t.bankName || !t.iban)) throw new Error("لإظهار الحساب البنكي أدخل اسم البنك والآيبان");
}

/** الآيبان مقسّماً كل أربعة أحرف ليسهل نقله. */
export const formatIban = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();
