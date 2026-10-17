import { describe, expect, it } from "vitest";
import { resolvePrice, type Rate } from "@/lib/pricing";

const rates: Rate[] = [
  { id: 1, method: "per_km_vehicle_type", vehicleTypeId: 10, routeId: null, vehicleId: null, price: 2.5, unit: null },
  { id: 2, method: "route_fixed", routeId: 100, vehicleTypeId: null, vehicleId: null, price: 3000, unit: null },
  { id: 3, method: "specific_vehicle", routeId: 100, vehicleId: 7, vehicleTypeId: null, price: 3200, unit: null },
  { id: 4, method: "car_transport", routeId: 100, vehicleTypeId: null, vehicleId: null, price: 900, unit: null },
  { id: 5, method: "per_quantity", unit: "طن", routeId: null, vehicleTypeId: null, vehicleId: null, price: 40 },
];

describe("تسعير الرحلة", () => {
  it("المركبة المحددة على المسار أولاً", () => {
    expect(resolvePrice(rates, { routeId: 100, vehicleId: 7, vehicleTypeId: 10, distanceKm: 400 })?.rateId).toBe(3);
  });
  it("ثم سعر المسار الثابت", () => {
    expect(resolvePrice(rates, { routeId: 100, vehicleId: 8, vehicleTypeId: 10, distanceKm: 400 })?.amount).toBe(3000);
  });
  it("ثم ريال/كم حسب نوع المركبة", () => {
    const r = resolvePrice(rates, { routeId: 200, vehicleTypeId: 10, distanceKm: 401 });
    expect(r?.amount).toBe(1002.5);
    expect(r?.method).toBe("per_km_vehicle_type");
  });
  it("نقل السيارة والكمية يُطلبان صراحة", () => {
    expect(resolvePrice(rates, { routeId: 100, carTransport: true })?.amount).toBe(900);
    expect(resolvePrice(rates, { quantity: { value: 25, unit: "طن" } })?.amount).toBe(1000);
  });
  it("لا سعر بلا بند مطابق", () => {
    expect(resolvePrice(rates, { routeId: 200, vehicleTypeId: 99, distanceKm: 100 })).toBeNull();
    expect(resolvePrice(rates, { routeId: 200, vehicleTypeId: 10 })).toBeNull();
  });
});
