import { describe, expect, it } from "vitest";
import { purchasePostingLines } from "@/lib/purchases";
import { validateLines } from "@/lib/ledger";

describe("قيد فاتورة المورد", () => {
  it("متوازن بالدينار، والضريبة مدينة على المدخلات ودائنة للمورد", () => {
    const lines = purchasePostingLines(
      { number: "PI-1", supplierInvoiceNo: "S-9", supplierId: 4, currencyCode: "KWD", exchangeRate: 12.2537, payableAccountId: 2104 },
      [
        { accountId: 5107, costCenterId: 50, description: "قطع غيار", amount: 133.333, vatAmount: 20 },
        { accountId: 5108, costCenterId: 51, description: "إطارات", amount: 77.77, vatAmount: 0 },
      ],
      1108,
      7,
    );
    expect(validateLines(lines)).toEqual([]);
    expect(lines.filter((l) => l.accountId === 2104).reduce((a, l) => a + (l.credit ?? 0), 0)).toBeCloseTo(231.103);
    expect(lines.find((l) => l.accountId === 1108)).toMatchObject({ debit: 20, taxCodeId: 7 });
    expect(lines.find((l) => l.accountId === 5108)).toMatchObject({ costCenterId: 51, partyId: 4 });
  });
});
