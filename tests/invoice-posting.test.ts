import { describe, expect, it } from "vitest";
import { invoicePostingLines, lineVat } from "@/lib/invoice-posting";
import { validateLines } from "@/lib/ledger";

const accounts = { receivable: 1103, outputVat: 2109 };

describe("قيد إصدار الفاتورة", () => {
  it("متوازن بالدينار مع التقريب، وكل سطر إيراد على مركز تكلفة مركبته", () => {
    const lines = invoicePostingLines(
      { number: "INV-1", customerId: 5, currencyCode: "KWD", exchangeRate: 12.2537 },
      [
        { accountId: 4102, amount: 333.333, vatAmount: 0, costCenterId: 50, waybillId: 1, description: "نقل" },
        { accountId: 4104, amount: 17.777, vatAmount: 2.667, costCenterId: 50, waybillId: 1, description: "انتظار" },
      ],
      accounts,
      9,
    );
    expect(validateLines(lines)).toEqual([]);
    expect(lines.find((l) => l.accountId === 4102)).toMatchObject({ credit: 333.333, costCenterId: 50, partyId: 5 });
    expect(lines.find((l) => l.accountId === 2109)).toMatchObject({ credit: 2.667, taxCodeId: 9 });
    expect(lines.filter((l) => l.accountId === 1103)).toHaveLength(3);
  });

  it("ضريبة السطر 15% مقربة لهللتين", () => {
    expect(lineVat(2650, 15)).toBe(397.5);
    expect(lineVat(33.33, 15)).toBe(5);
  });
});
