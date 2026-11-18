// أنواع الضريبة بأسمائها في «وافق» حرفياً، ليطابق الاستيراد من Excel ما يصدّره وافق.
// «السلوك» (box) يحدد كل شيء: النسبة، والجهة (مبيعات/مشتريات)، وفئة الفوترة الإلكترونية،
// وسبب الإعفاء أو النسبة الصفرية، وخانة إقرار الضريبة، والحساب. النوع الذي يضيفه المستخدم
// يختار «يتصرف مثل» أحد هذه السلوكيات، فلا يتغير منطق القيود ولا الإقرار.

export type TaxSide = "sales" | "purchases" | "both";
export type TaxKind = "output" | "input" | "zero_rated" | "exempt";

export interface TaxBehavior {
  label: string;
  side: TaxSide;
  rate: number;
  kind: TaxKind;
  /** فئة ZATCA للمبيعات: S أساسية، Z صفرية، E معفاة، O خارج النطاق */
  category: "S" | "Z" | "E" | "O" | null;
  exemptionCode: string | null;
  exemptionReason: string | null;
  /** حساب الضريبة في الشجرة (لا شيء للنسبة الصفرية والمعفاة) */
  account: "2109" | "1108" | null;
  /** عنوان خانة الإقرار */
  box: string;
}

export const TAX_BEHAVIORS = {
  standard: { label: "ضريبة القيمة المضافة على الإيرادات", side: "sales", rate: 15, kind: "output", category: "S", exemptionCode: null, exemptionReason: null, account: "2109", box: "المبيعات الخاضعة للنسبة الأساسية" },
  zero: { label: "توريدات داخل المملكة خاضعة للضريبة بنسبة صفر", side: "sales", rate: 0, kind: "zero_rated", category: "Z", exemptionCode: "VATEX-SA-34-1", exemptionReason: "The international transport of Goods", account: "2109", box: "المبيعات المحلية الخاضعة للنسبة الصفرية" },
  export: { label: "صادرات", side: "sales", rate: 0, kind: "zero_rated", category: "Z", exemptionCode: "VATEX-SA-33", exemptionReason: "Export of services", account: "2109", box: "الصادرات" },
  exempt: { label: "معفى", side: "sales", rate: 0, kind: "exempt", category: "E", exemptionCode: "VATEX-SA-29", exemptionReason: "Financial services mentioned in Article 29 of the VAT Regulations", account: null, box: "المبيعات المعفاة" },
  out_of_scope: { label: "غير خاضع للضريبة", side: "both", rate: 0, kind: "exempt", category: "O", exemptionCode: "VATEX-SA-OOS", exemptionReason: "Not subject to VAT", account: null, box: "غير خاضع للضريبة" },
  pur_standard: { label: "ضريبة القيمة المضافة على مشتريات", side: "purchases", rate: 15, kind: "input", category: null, exemptionCode: null, exemptionReason: null, account: "1108", box: "المشتريات الخاضعة للنسبة الأساسية" },
  customs: { label: "ضريبة القيمة المضافة في الجمارك", side: "purchases", rate: 15, kind: "input", category: null, exemptionCode: null, exemptionReason: null, account: "1108", box: "الاستيرادات الخاضعة للضريبة المدفوعة في الجمارك" },
  reverse: { label: "إحتساب عكسي", side: "purchases", rate: 15, kind: "input", category: null, exemptionCode: null, exemptionReason: null, account: "1108", box: "الاستيرادات الخاضعة للضريبة بآلية الاحتساب العكسي" },
  pur_zero: { label: "مشتريات بنسبة صفر", side: "purchases", rate: 0, kind: "zero_rated", category: null, exemptionCode: null, exemptionReason: null, account: null, box: "المشتريات الخاضعة للنسبة الصفرية" },
  pur_exempt: { label: "مشتريات معفاة من الضريبة", side: "purchases", rate: 0, kind: "exempt", category: null, exemptionCode: null, exemptionReason: null, account: null, box: "المشتريات المعفاة" },
} as const satisfies Record<string, TaxBehavior>;

export type TaxBehaviorKey = keyof typeof TAX_BEHAVIORS;
export const isTaxBehavior = (k: unknown): k is TaxBehaviorKey => typeof k === "string" && k in TAX_BEHAVIORS;

/** الرموز الأساسية في كل شركة؛ الثلاثة الأولى موجودة منذ البداية وتُعاد تسميتها فقط. */
export const DEFAULT_TAX_CODES: { code: string; behavior: TaxBehaviorKey; sort: number }[] = [
  { code: "VAT15-OUT", behavior: "standard", sort: 1 },
  { code: "ZERO", behavior: "zero", sort: 2 },
  { code: "EXPORT", behavior: "export", sort: 3 },
  { code: "EXEMPT", behavior: "exempt", sort: 4 },
  { code: "OOS", behavior: "out_of_scope", sort: 5 },
  { code: "VAT15-IN", behavior: "pur_standard", sort: 6 },
  { code: "VAT-CUSTOMS", behavior: "customs", sort: 7 },
  { code: "REVERSE", behavior: "reverse", sort: 8 },
  { code: "PUR-ZERO", behavior: "pur_zero", sort: 9 },
  { code: "PUR-EXEMPT", behavior: "pur_exempt", sort: 10 },
];

/** رمز الضريبة التلقائي للشحنة: الدولية «نسبة صفر (نقل دولي)»، والداخلية الأساسية. */
export const waybillTaxCode = (international: boolean) => (international ? "ZERO" : "VAT15-OUT");

/** يوحّد الاسم للمطابقة: يحذف «(15.00%)» في آخره كما يصدّره وافق، ويوحّد الياء والهمزات. */
export function normalizeTaxName(raw: string) {
  return raw
    .replace(/\(\s*[\d.]+\s*%\s*\)\s*$/, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
