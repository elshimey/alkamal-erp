export const WAYBILL_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  in_transit: { label: "في الطريق", tone: "blue" },
  delivered: { label: "مُسلَّمة", tone: "amber" },
  approved: { label: "معتمدة", tone: "green" },
  invoiced: { label: "مفوترة", tone: "green" },
  rejected: { label: "مرفوضة", tone: "red" },
} as const;
export type WaybillStatus = keyof typeof WAYBILL_STATUS;

export const TRIP_STAGES = {
  loading: "تحميل",
  in_transit: "في الطريق",
  border: "الحدود",
  delivery: "تسليم",
} as const;

export const FUEL_SOURCES = {
  custody: "عهدة السائق",
  fuel_card: "بطاقة وقود",
  station_credit: "محطة بالآجل",
} as const;

export const EXPENSE_PAYERS = {
  driver_custody: "عهدة السائق",
  customs_broker: "المخلص",
} as const;

export const EXPENSE_BILL_TO = {
  company: "على الشركة",
  customer: "على العميل (يُفوتر)",
} as const;

// الحسابات التي يستخدمها قيد اعتماد الشحنة (خريطة القيود التلقائية)
export const WAYBILL_ACCOUNTS = {
  fuelCost: "5101",
  driverCommission: "5102",
  tripExpenses: "5104",
  carrierCost: "5105",
  salesRepCommission: "5114",
  fuelCards: "1106",
  inputVat: "1108",
  carriers: "2102",
  fuelStations: "2103",
  customsBrokers: "2105",
  accrued: "2106",
} as const;
export type WaybillAccountKey = keyof typeof WAYBILL_ACCOUNTS;

// مراحل الشحنة بالترتيب؛ تغيير الحالة من الجدول يتقدم أو يرجع عليها خطوة أو أكثر
export const WAYBILL_FLOW = ["draft", "in_transit", "delivered", "approved"] as const satisfies readonly WaybillStatus[];
export type WaybillFlowStatus = (typeof WAYBILL_FLOW)[number];

// تبويب «بانتظار الفوترة» = معتمدة لم تدخل أي فاتورة
export const WAYBILL_TABS = ["draft", "in_transit", "delivered", "approved", "pending_invoice", "invoiced", "rejected"] as const;

export const WAYBILL_SORTS = {
  date_desc: "الأحدث أولاً",
  date_asc: "الأقدم أولاً",
  amount_desc: "الأعلى مبلغاً",
  amount_asc: "الأقل مبلغاً",
  number_desc: "الرقم تنازلياً",
  party_asc: "حسب العميل",
} as const;
export type WaybillSort = keyof typeof WAYBILL_SORTS;

// ───────────── وثيقة النقل (لوجستي) ─────────────

export const PLATE_TYPES = {
  public_transport: "نقل عام",
  private_transport: "نقل خاص",
  private: "خصوصي",
  heavy_equipment: "معدات ثقيلة",
  temporary: "مؤقتة",
  export: "تصدير",
  foreign: "أجنبية",
} as const;
export type PlateType = keyof typeof PLATE_TYPES;

export const FREIGHT_PAYERS = { shipper: "المرسل", consignee: "المرسل إليه" } as const;
export type FreightPayer = keyof typeof FREIGHT_PAYERS;

export const PAYMENT_METHODS = { credit: "آجل", cash: "نقداً", transfer: "تحويل بنكي" } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const LOGISTI_STATUSES = { none: "لم تصدر", issued: "صادرة", closed: "مغلقة", cancelled: "ملغاة" } as const;
export type LogistiStatus = keyof typeof LOGISTI_STATUSES;

export const PACKAGE_UNITS = {
  piece: "قطعة",
  package: "طرد",
  carton: "كرتون",
  pallet: "طبلية",
  bag: "كيس",
  container: "حاوية",
  vehicle: "مركبة",
  bulk: "سائب",
} as const;
export type PackageUnit = keyof typeof PACKAGE_UNITS;

export const WEIGHT_UNITS = { kg: "كجم", ton: "طن" } as const;
export type WeightUnit = keyof typeof WEIGHT_UNITS;

export const GOODS_CONDITIONS = { good: "سليمة", partial: "تلف جزئي", damaged: "تالفة", unknown: "غير محددة" } as const;
export type GoodsCondition = keyof typeof GOODS_CONDITIONS;
