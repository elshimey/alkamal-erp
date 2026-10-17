import type { Db } from "@/db";
import * as s from "@/db/schema";

export interface VehicleInput {
  plate: string;
  chassis: string;
  vehicleTypeId?: number | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  ownership?: "owned" | "leased";
  odometer?: number;
}

/** يضيف المركبة وينشئ مركز تكلفتها في معاملة واحدة (القرار 8). */
export async function createVehicle(db: Db, input: VehicleInput) {
  const plate = input.plate.trim();
  return db.transaction(async (tx) => {
    const [cc] = await tx
      .insert(s.costCenters)
      .values({ code: `V-${plate}`, nameAr: `المركبة ${plate}`, type: "vehicle" })
      .returning({ id: s.costCenters.id });
    const [vehicle] = await tx
      .insert(s.vehicles)
      .values({
        plate,
        chassis: input.chassis.trim(),
        vehicleTypeId: input.vehicleTypeId ?? null,
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
        ownership: input.ownership ?? "owned",
        odometer: input.odometer ?? 0,
        costCenterId: cc.id,
      })
      .returning();
    return vehicle;
  });
}
