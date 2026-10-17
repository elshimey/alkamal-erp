// حساب مبلغ البوليصة من بنود تسعير العقد الساري.
// الأولوية من الأخص إلى الأعم: مركبة محددة على المسار، ثم سعر المسار الثابت،
// ثم ريال/كم حسب نوع المركبة. نقل السيارات والكمية يُطلبان صراحة.

export type PricingMethod = "per_km_vehicle_type" | "specific_vehicle" | "route_fixed" | "car_transport" | "per_quantity";

export interface Rate {
  id: number;
  method: PricingMethod;
  routeId: number | null;
  vehicleTypeId: number | null;
  vehicleId: number | null;
  price: number;
  unit: string | null;
}

export interface Trip {
  routeId?: number | null;
  distanceKm?: number | null;
  vehicleId?: number | null;
  vehicleTypeId?: number | null;
  carTransport?: boolean;
  quantity?: { value: number; unit: string } | null;
}

export interface PriceResult {
  amount: number;
  rateId: number;
  method: PricingMethod;
  explanation: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function resolvePrice(rates: Rate[], trip: Trip): PriceResult | null {
  const pick = (method: PricingMethod, match: (r: Rate) => boolean) => rates.find((r) => r.method === method && match(r));

  if (trip.quantity) {
    const r = pick("per_quantity", (r) => r.unit === trip.quantity!.unit && (r.routeId == null || r.routeId === trip.routeId));
    if (!r) return null;
    return {
      amount: round2(r.price * trip.quantity.value),
      rateId: r.id,
      method: r.method,
      explanation: `${trip.quantity.value} ${r.unit} × ${r.price}`,
    };
  }

  if (trip.carTransport) {
    const r = pick("car_transport", (r) => r.routeId === trip.routeId);
    return r ? { amount: r.price, rateId: r.id, method: r.method, explanation: "نقل سيارة مقطوع" } : null;
  }

  if (trip.routeId != null && trip.vehicleId != null) {
    const r = pick("specific_vehicle", (r) => r.routeId === trip.routeId && r.vehicleId === trip.vehicleId);
    if (r) return { amount: r.price, rateId: r.id, method: r.method, explanation: "سعر المركبة على المسار" };
  }

  if (trip.routeId != null) {
    const r = pick("route_fixed", (r) => r.routeId === trip.routeId);
    if (r) return { amount: r.price, rateId: r.id, method: r.method, explanation: "سعر المسار الثابت" };
  }

  if (trip.vehicleTypeId != null && trip.distanceKm) {
    const r = pick("per_km_vehicle_type", (r) => r.vehicleTypeId === trip.vehicleTypeId);
    if (r) {
      return {
        amount: round2(r.price * trip.distanceKm),
        rateId: r.id,
        method: r.method,
        explanation: `${trip.distanceKm} كم × ${r.price} ريال/كم`,
      };
    }
  }

  return null;
}
