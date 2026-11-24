// كل قيمة لمستوى الوقود يجب أن تتسع لها خانتها، وإلا فشل حفظ المحضر («ثلاثة أرباع» = three_quarters، 14 حرفاً).
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { vehicleHandovers } from "@/db/schema";
import { FUEL_LEVEL } from "@/data/handovers";

describe("مستوى الوقود في محضر المركبة", () => {
  it("كل القيم تتسع لها الخانة", () => {
    const col = getTableConfig(vehicleHandovers).columns.find((c) => c.name === "fuel_level") as unknown as { length: number };
    for (const k of Object.keys(FUEL_LEVEL)) expect(k.length).toBeLessThanOrEqual(col.length);
  });
});
