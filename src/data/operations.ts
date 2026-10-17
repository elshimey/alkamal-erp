export const PARTY_ROLES = {
  customer: "عميل",
  supplier: "مورد",
  carrier: "ناقل خارجي",
  workshop: "ورشة",
  fuel_station: "محطة وقود",
  customs_broker: "مخلص جمركي",
  sales_rep: "مندوب",
} as const;

export const PRICING_METHODS = {
  route_fixed: "مسار بسعر ثابت",
  per_km_vehicle_type: "ريال/كم حسب نوع المركبة",
  specific_vehicle: "مركبة محددة على مسار",
  car_transport: "نقل سيارة مقطوع",
  per_quantity: "بالكمية",
} as const;

export const CONTRACT_STATUS = {
  draft: { label: "مسودة", tone: "gray" },
  active: { label: "ساري", tone: "green" },
  expired: { label: "منتهٍ", tone: "amber" },
  suspended: { label: "موقوف", tone: "red" },
} as const;

export const YES_NO = [
  { value: "yes", label: "نعم" },
  { value: "no", label: "لا" },
];
