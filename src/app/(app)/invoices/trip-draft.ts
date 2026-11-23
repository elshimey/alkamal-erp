// نقل الفاتورة المباشرة في نافذتها (نفس حقول الشحنة). ملف عادي لا «use client» حتى تقرأ الصفحة القيم الافتراضية.
import type { PriceComponentDraft } from "../waybills/waybill-editor";

export interface TripDraft {
  on: boolean;
  /** سعر النقل في الرحلة نفسها (الطريقة الحالية). false = مسودة قديمة سعرها في البنود */
  priced: boolean;
  routeId: string;
  execution: "fleet" | "carrier";
  vehicleId: string;
  trailerId: string;
  driverId: string;
  commission: string;
  custody: string;
  carrierId: string;
  carrierCost: string;
  carrierPlate: string;
  carrierDriverName: string;
  shipper: string;
  consignee: string;
  amount: string;
  components: PriceComponentDraft[];
  taxCodeId: string;
  weight: string;
  container: string;
  deliveryNote: string;
  customs: string;
  priceNote?: string | null;
  number?: string;
  sent?: boolean;
  /** «أرسلها للسائق على مرحلة التسليم» مع الحفظ */
  send: boolean;
  /** الحساب الذي تُصرف منه عهدة الرحلة عند الإرسال، أو «defer» = لم تُصرف بعد */
  custodyFrom: string;
}

export const NO_TRIP: TripDraft = {
  on: false,
  priced: true,
  routeId: "",
  execution: "fleet",
  vehicleId: "",
  trailerId: "",
  driverId: "",
  commission: "",
  custody: "",
  carrierId: "",
  carrierCost: "",
  carrierPlate: "",
  carrierDriverName: "",
  shipper: "",
  consignee: "",
  amount: "",
  components: [],
  taxCodeId: "",
  weight: "",
  container: "",
  deliveryNote: "",
  customs: "",
  send: false,
  custodyFrom: "",
};
