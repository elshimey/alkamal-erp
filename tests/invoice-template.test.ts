import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATE, formatIban, normalizeTemplate, validateTemplate } from "@/lib/invoice-template";

describe("قالب الفاتورة", () => {
  it("يدمج المحفوظ مع الافتراضي ويتجاهل القيم غير المعروفة", () => {
    expect(normalizeTemplate(null)).toEqual(DEFAULT_TEMPLATE);
    const t = normalizeTemplate({ layout: "band", accent: "x", language: "ar", showQr: "yes", iban: " sa03 8000 0000 6080 1016 7519 ", extra: 1 });
    expect(t).toMatchObject({ layout: "band", accent: "road", language: "ar", showQr: true, iban: "SA0380000000608010167519" });
    expect(t).not.toHaveProperty("extra");
  });
  it("الآيبان السعودي وبيانات البنك عند إظهارها", () => {
    expect(() => validateTemplate({ ...DEFAULT_TEMPLATE, iban: "SA123" })).toThrow("الآيبان");
    expect(() => validateTemplate({ ...DEFAULT_TEMPLATE, showBank: true })).toThrow("اسم البنك");
    expect(() => validateTemplate({ ...DEFAULT_TEMPLATE, showBank: true, bankName: "الراجحي", iban: "SA0380000000608010167519" })).not.toThrow();
    expect(formatIban("SA0380000000608010167519")).toBe("SA03 8000 0000 6080 1016 7519");
  });
});
