import { describe, expect, it } from "vitest";
import { normalizePlate, plateKey } from "@/lib/plates";
import { vehicleOnDate } from "@/lib/driver-vehicle";

describe("توحيد صيغة اللوحة (ملاحظة التشغيل 1)", () => {
  it("كل الصيغ تُحفظ «ا ب ج 1234»", () => {
    expect(normalizePlate("9668 / ا ر ه")).toBe("ا ر ه 9668");
    expect(normalizePlate("/ ا د ع 1355")).toBe("ا د ع 1355");
    expect(normalizePlate("ا ر ه 9663")).toBe("ا ر ه 9663");
    expect(normalizePlate("اره٩٦٦٣")).toBe("ا ر ه 9663");
    expect(normalizePlate("د هـ و 5678")).toBe("د هـ و 5678");
    expect(plateKey(normalizePlate("9668 / ا ر ه"))).toBe(plateKey("ا ر ه 9668"));
  });
  it("اللوحة الأجنبية تبقى كما هي", () => {
    expect(normalizePlate("ACME  1")).toBe("ACME 1");
    expect(normalizePlate("12/34567")).toBe("12/34567");
  });
  it("الاسم الوصفي بأكثر من أربعة أحرف يبقى كما كُتب", () => {
    expect(normalizePlate("ميكروباص  خالو محمد")).toBe("ميكروباص خالو محمد");
  });
});

describe("المركبة المسندة للسائق في تاريخ المستند", () => {
  const periods = [
    { v: "1", from: "2026-01-01", to: "2026-03-31" },
    { v: "2", from: "2026-04-01", to: null },
  ];
  it("حسب التاريخ بأي صيغة", () => {
    expect(vehicleOnDate(periods, "2026-02-10")).toBe("1");
    expect(vehicleOnDate(periods, "10/02/2026")).toBe("1");
    expect(vehicleOnDate(periods, "10022026")).toBe("1");
    expect(vehicleOnDate(periods, "2026-05-01")).toBe("2");
  });
  it("دون تاريخ: الإسناد المفتوح، وقبل أي إسناد: فارغ", () => {
    expect(vehicleOnDate(periods, "")).toBe("2");
    expect(vehicleOnDate(periods, "2025-12-31")).toBe("");
    expect(vehicleOnDate(undefined, "2026-02-10")).toBe("");
  });
});
