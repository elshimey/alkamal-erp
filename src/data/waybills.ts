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

// الحسابات التي يستخدمها قيد اعتماد البوليصة (خريطة القيود التلقائية)
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
