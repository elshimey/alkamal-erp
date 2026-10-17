import { describe, expect, it } from "vitest";
import { waybillPostingLines, type PostingWaybill } from "@/lib/waybill-posting";
import { validateLines } from "@/lib/ledger";
import { WAYBILL_ACCOUNTS, type WaybillAccountKey } from "@/data/waybills";

// معرّفات وهمية: كل حساب معرّفه هو رمزه
const account = Object.fromEntries(Object.entries(WAYBILL_ACCOUNTS).map(([k, code]) => [k, Number(code)])) as Record<WaybillAccountKey, number>;

const fleet: PostingWaybill = {
  id: 7,
  number: "WB-2026-000007",
  execution: "fleet",
  costCenterId: 50,
  driverId: 3,
  driverCustodyAccountId: 110501,
  driverPayableAccountId: 210701,
  driverCommission: 150,
  carrierId: null,
  carrierCost: 0,
  salesRepId: null,
  salesRepCommission: 0,
};

describe("قيد اعتماد البوليصة", () => {
  it("متوازن، والديزل بالدينار يُقيد بسعر صرفه", () => {
    const lines = waybillPostingLines(
      fleet,
      [{ source: "fuel_card", partyId: 9, amount: 30, vatAmount: 0, currencyCode: "KWD", exchangeRate: 12.25 }],
      [{ costAccountId: null, label: "تخليص", payer: "customs_broker", partyId: 11, amount: 250, currencyCode: "SAR", exchangeRate: 1 }],
      account,
      1,
    );
    expect(validateLines(lines)).toEqual([]);
    expect(lines.find((l) => l.accountId === 1106)).toMatchObject({ credit: 30, currencyCode: "KWD", exchangeRate: 12.25, partyId: 9 });
    expect(lines.find((l) => l.accountId === 2105)).toMatchObject({ credit: 250, partyId: 11 });
    expect(lines.find((l) => l.accountId === 5104)).toMatchObject({ debit: 250, costCenterId: 50 });
    expect(lines.find((l) => l.accountId === 210701)).toMatchObject({ credit: 150, driverId: 3 });
  });

  it("بوليصة الناقل لا تقبل الدفع من عهدة سائق", () => {
    const carrier = { ...fleet, execution: "carrier" as const, driverId: null, driverCustodyAccountId: null, driverPayableAccountId: null, carrierId: 20, carrierCost: 900 };
    expect(() =>
      waybillPostingLines(carrier, [{ source: "custody", partyId: null, amount: 10, vatAmount: 0, currencyCode: "SAR", exchangeRate: 1 }], [], account, 1),
    ).toThrow("عهدة السائق");
    const lines = waybillPostingLines(carrier, [], [], account, 1);
    expect(lines).toHaveLength(2);
    expect(validateLines(lines)).toEqual([]);
  });

  it("بلا تكاليف لا سطور", () => {
    expect(waybillPostingLines({ ...fleet, driverCommission: 0 }, [], [], account, 1)).toEqual([]);
  });
});
