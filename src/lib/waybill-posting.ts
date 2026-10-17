// قيد اعتماد البوليصة (القرار 3: التكلفة عند الاعتماد، والإيراد لاحقاً عند الفوترة).
// دالة صافية بلا قاعدة بيانات حتى تُختبر وحدها:
//   الديزل: مدين تكلفة الديزل (+ ضريبة المدخلات) / دائن مصدره (عهدة السائق، بطاقة الوقود، المحطة)
//   العمولة: مدين عمولات السائقين / دائن رواتب السائق المستحقة
//   المصاريف: مدين حساب تكلفة نوع المصروف / دائن عهدة السائق أو المخلص
//   الناقل الخارجي: مدين تكلفة الناقلين / دائن الناقل
//   المندوب: مدين عمولات المناديب / دائن مصروفات مستحقة (المندوب)
import type { WaybillAccountKey } from "@/data/waybills";
import type { LineInput } from "@/lib/ledger";

export interface PostingWaybill {
  id: number;
  number: string;
  execution: "fleet" | "carrier";
  costCenterId: number; // مركز تكلفة المركبة، أو مركز الناقلين الخارجيين
  driverId: number | null;
  driverCustodyAccountId: number | null;
  driverPayableAccountId: number | null;
  driverCommission: number;
  carrierId: number | null;
  carrierCost: number;
  salesRepId: number | null;
  salesRepCommission: number;
}

export interface PostingFuel {
  source: "custody" | "fuel_card" | "station_credit";
  partyId: number | null;
  amount: number;
  vatAmount: number;
  currencyCode: string;
  exchangeRate: number;
}

export interface PostingExpense {
  costAccountId: number | null;
  label: string;
  payer: "driver_custody" | "customs_broker";
  partyId: number | null;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
}

export function waybillPostingLines(
  w: PostingWaybill,
  fuel: PostingFuel[],
  expenses: PostingExpense[],
  account: Record<WaybillAccountKey, number>,
  inputVatTaxCodeId: number | null,
): LineInput[] {
  const lines: LineInput[] = [];
  const dims = { costCenterId: w.costCenterId, driverId: w.driverId, waybillId: w.id };
  const custody = () => {
    if (!w.driverCustodyAccountId) throw new Error("الدفع من عهدة السائق يحتاج سائقاً من الأسطول");
    return w.driverCustodyAccountId;
  };
  const pair = (debit: LineInput, credit: Omit<LineInput, "debit">, amount: number) => {
    lines.push({ ...debit, debit: amount }, { ...credit, credit: amount });
  };

  for (const f of fuel) {
    const fx = { currencyCode: f.currencyCode, exchangeRate: f.exchangeRate };
    const creditAccount =
      f.source === "custody" ? custody() : f.source === "fuel_card" ? account.fuelCards : account.fuelStations;
    lines.push({ accountId: account.fuelCost, debit: f.amount, ...fx, ...dims, description: `ديزل البوليصة ${w.number}` });
    if (f.vatAmount > 0) {
      lines.push({ accountId: account.inputVat, debit: f.vatAmount, ...fx, taxCodeId: inputVatTaxCodeId, waybillId: w.id, description: "ضريبة مدخلات الديزل" });
    }
    lines.push({
      accountId: creditAccount,
      credit: f.amount + f.vatAmount,
      ...fx,
      partyId: f.partyId,
      driverId: w.driverId,
      waybillId: w.id,
      description: `ديزل البوليصة ${w.number}`,
    });
  }

  if (w.execution === "fleet" && w.driverCommission > 0) {
    if (!w.driverPayableAccountId) throw new Error("السائق بلا حساب رواتب مستحقة");
    pair(
      { accountId: account.driverCommission, ...dims, description: `عمولة السائق – ${w.number}` },
      { accountId: w.driverPayableAccountId, driverId: w.driverId, waybillId: w.id, description: `عمولة البوليصة ${w.number}` },
      w.driverCommission,
    );
  }

  for (const e of expenses) {
    const fx = { currencyCode: e.currencyCode, exchangeRate: e.exchangeRate };
    if (e.payer === "customs_broker" && !e.partyId) throw new Error(`المصروف «${e.label}»: اختر المخلص`);
    pair(
      { accountId: e.costAccountId ?? account.tripExpenses, ...fx, ...dims, description: `${e.label} – ${w.number}` },
      {
        accountId: e.payer === "driver_custody" ? custody() : account.customsBrokers,
        ...fx,
        partyId: e.payer === "customs_broker" ? e.partyId : null,
        driverId: w.driverId,
        waybillId: w.id,
        description: `${e.label} – ${w.number}`,
      },
      e.amount,
    );
  }

  if (w.execution === "carrier") {
    if (!w.carrierId || !(w.carrierCost > 0)) throw new Error("أدخل الناقل وتكلفة النقل");
    pair(
      { accountId: account.carrierCost, ...dims, partyId: w.carrierId, description: `ناقل خارجي – ${w.number}` },
      { accountId: account.carriers, partyId: w.carrierId, waybillId: w.id, description: `تكلفة نقل البوليصة ${w.number}` },
      w.carrierCost,
    );
  }

  if (w.salesRepId && w.salesRepCommission > 0) {
    pair(
      { accountId: account.salesRepCommission, ...dims, partyId: w.salesRepId, description: `عمولة المندوب – ${w.number}` },
      { accountId: account.accrued, partyId: w.salesRepId, waybillId: w.id, description: `عمولة المندوب – ${w.number}` },
      w.salesRepCommission,
    );
  }

  return lines;
}
