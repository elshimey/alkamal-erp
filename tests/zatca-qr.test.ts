import { describe, expect, it } from "vitest";
import { zatcaTlv } from "@/lib/zatca-qr";
import { parseDocFilter, periodRange } from "@/lib/doc-filters";

describe("رمز الفاتورة الضريبية", () => {
  it("حقول TLV الخمسة بالترتيب وبطول البايتات للعربي", () => {
    const b = Buffer.from(zatcaTlv({ sellerName: "الكمال", vatNumber: "310123456700003", timestamp: "2026-08-31T09:00:00.000Z", total: 1150, vatTotal: 150 }), "base64");
    const fields: string[] = [];
    for (let i = 0; i < b.length; ) {
      expect(b[i]).toBe(fields.length + 1);
      fields.push(b.subarray(i + 2, i + 2 + b[i + 1]).toString("utf8"));
      i += 2 + b[i + 1];
    }
    expect(fields).toEqual(["الكمال", "310123456700003", "2026-08-31T09:00:00.000Z", "1150.00", "150.00"]);
  });
});

describe("فلاتر قوائم الفواتير", () => {
  it("الفترات النسبية إلى اليوم", () => {
    expect(periodRange("month", "2026-02-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("last_month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("quarter", "2026-08-31")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodRange("all", "2026-08-31")).toEqual({});
  });
  it("يتجاهل القيم غير المعروفة", () => {
    expect(parseDocFilter({ status: "x", pay: "y", sort: "z", q: "  " }, ["draft"], "2026-08-31")).toEqual({ q: undefined, status: undefined, pay: undefined, period: "all", sort: "date_desc", today: "2026-08-31" });
  });
});
