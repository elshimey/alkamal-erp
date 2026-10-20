import { describe, expect, it } from "vitest";
import { periodRange, resolvePeriod } from "@/lib/dashboard";

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
  it("الأسبوع يبدأ الأحد ويقارن بنفس الأيام من الأسبوع الماضي", () => {
    // 2026-10-20 يوم ثلاثاء
    expect(periodRange("week", "2026-10-20")).toEqual({ from: "2026-10-18", to: "2026-10-20", prevFrom: "2026-10-11", prevTo: "2026-10-13" });
  });
  it("الفترة المخصصة تقارن بنفس عدد الأيام قبلها، وتصحح الترتيب والقيم الخاطئة", () => {
    expect(resolvePeriod({ p: "custom", from: "2026-10-11", to: "2026-10-20" }, "2026-10-20")).toMatchObject({ key: "custom", from: "2026-10-11", to: "2026-10-20", prevFrom: "2026-10-01", prevTo: "2026-10-10" });
    expect(resolvePeriod({ p: "custom", from: "2026-10-20", to: "2026-10-11" }, "2026-10-20")).toMatchObject({ from: "2026-10-11", to: "2026-10-20" });
    expect(resolvePeriod({ p: "custom", from: "bad" }, "2026-10-20")).toMatchObject({ key: "month", from: "2026-10-01" });
    expect(resolvePeriod({}, "2026-10-20")).toMatchObject({ key: "month", label: "هذا الشهر" });
  });
});
