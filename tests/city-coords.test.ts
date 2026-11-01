import { describe, expect, it } from "vitest";
import { cityPoint } from "@/data/city-coords";

describe("مشهد الأسطول: إحداثيات المدن", () => {
  it("يعرف المدن الشائعة مع اختلاف كتابة الهمزة والتاء المربوطة", () => {
    expect(cityPoint("الرياض", "SA")).toEqual([24.71, 46.68]);
    expect(cityPoint("مكه المكرمه", "SA")).toEqual([21.39, 39.86]);
    expect(cityPoint("ابوظبي", "AE")).toEqual([24.45, 54.38]);
  });

  it("المدينة المجهولة توضع قرب مركز دولتها، وبموضع ثابت", () => {
    const a = cityPoint("قرية جديدة", "KW");
    expect(Math.abs(a[0] - 29.3)).toBeLessThan(1);
    expect(Math.abs(a[1] - 47.7)).toBeLessThan(1);
    expect(cityPoint("قرية جديدة", "KW")).toEqual(a);
    expect(cityPoint("قرية أخرى", "KW")).not.toEqual(a);
  });
});
