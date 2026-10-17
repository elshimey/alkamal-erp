import { describe, expect, it } from "vitest";
import { validateLines } from "@/lib/ledger";

describe("التحقق من سطور القيد", () => {
  it("يقبل قيداً متوازناً", () => {
    expect(validateLines([{ accountId: 1, debit: 100 }, { accountId: 2, credit: 100 }])).toEqual([]);
  });

  it("يرفض قيداً غير متوازن", () => {
    expect(validateLines([{ accountId: 1, debit: 100 }, { accountId: 2, credit: 90 }]).join()).toContain("غير متوازن");
  });

  it("يرفض سطراً بمدين ودائن معاً أو بلا مبلغ", () => {
    expect(validateLines([{ accountId: 1, debit: 5, credit: 5 }, { accountId: 2 }])).toHaveLength(2);
  });

  it("يوازن بالريال عند استخدام الدينار", () => {
    const errors = validateLines([
      { accountId: 1, debit: 100, currencyCode: "KWD", exchangeRate: 12.25 },
      { accountId: 2, credit: 1225 },
    ]);
    expect(errors).toEqual([]);
  });

  it("يرفض سعر صرف غير 1 للريال", () => {
    expect(validateLines([{ accountId: 1, debit: 10, exchangeRate: 2 }, { accountId: 2, credit: 20 }]).join()).toContain("الريال");
  });
});
