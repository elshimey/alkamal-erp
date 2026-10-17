import { describe, expect, it } from "vitest";
import { periodRange } from "@/lib/dashboard";

describe("فترات اللوحة الرئيسية", () => {
  it("الشهر الحالي يقارن بنفس الأيام من الشهر السابق", () => {
    expect(periodRange("month", "2026-10-17")).toEqual({ from: "2026-10-01", to: "2026-10-17", prevFrom: "2026-09-01", prevTo: "2026-09-17" });
  });
  it("لا تتجاوز المقارنة نهاية الشهر السابق القصير", () => {
    expect(periodRange("month", "2026-03-31")).toMatchObject({ prevFrom: "2026-02-01", prevTo: "2026-02-28" });
  });
  it("الربع والسنة", () => {
    expect(periodRange("quarter", "2026-11-05")).toEqual({ from: "2026-10-01", to: "2026-11-05", prevFrom: "2026-07-01", prevTo: "2026-08-05" });
    expect(periodRange("year", "2026-10-17")).toMatchObject({ from: "2026-01-01", prevFrom: "2025-01-01", prevTo: "2025-10-17" });
  });
});
