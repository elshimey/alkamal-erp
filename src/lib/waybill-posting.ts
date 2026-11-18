// قيد اعتماد الشحنة (القرار 3: التكلفة عند الاعتماد، والإيراد لاحقاً عند الفوترة).
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
  payer: "driver_custody" | "customs_broker" | "cash";
  partyId: number | null;
  cashAccountId?: number | null;
  // على العميل: مدين «مصاريف مستردة من العملاء» 1114 بدل تكلفة المركبة (يُقفل عند الفوترة)
  billToCustomer?: boolean;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
}

/** قيود مصاريف الرحلة: مع قيد الاعتماد، أو قيداً مستقلاً لمصروف أُضيف بعده. */
export function waybillExpenseLines(
  w: Pick<PostingWaybill, "id" | "number" | "costCenterId" | "driverId" | "driverCustodyAccountId">,
  expenses: PostingExpense[],
  account: Pick<Record<WaybillAccountKey, number>, "tripExpenses" | "customsBrokers" | "rechargeable">,
): LineInput[] {
  const lines: LineInput[] = [];
  for (const e of expenses) {
    const fx = { currencyCode: e.currencyCode, exchangeRate: e.exchangeRate };
    if (e.payer === "customs_broker" && !e.partyId) throw new Error(`المصروف «${e.label}»: اختر المخلص`);
    if (e.payer === "cash" && !e.cashAccountId) throw new Error(`المصروف «${e.label}»: اختر الصندوق أو البنك`);
    if (e.payer === "driver_custody" && !w.driverCustodyAccountId) throw new Error("الدفع من عهدة السائق يحتاج سائقاً من الأسطول");
    const description = `${e.label} – ${w.number}`;
    const debit: LineInput = e.billToCustomer
      ? { accountId: account.rechargeable, ...fx, driverId: w.driverId, waybillId: w.id, description: `على العميل: ${description}`, debit: e.amount }
      : { accountId: e.costAccountId ?? account.tripExpenses, ...fx, costCenterId: w.costCenterId, driverId: w.driverId, waybillId: w.id, description, debit: e.amount };
    lines.push(debit, {
      accountId: e.payer === "driver_custody" ? w.driverCustodyAccountId! : e.payer === "cash" ? e.cashAccountId! : account.customsBrokers,
      ...fx,
      partyId: e.payer === "customs_broker" ? e.partyId : null,
      driverId: w.driverId,
      waybillId: w.id,
      description,
      credit: e.amount,
    });
  }
  return lines;
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
    const credit = { accountId: creditAccount, ...fx, partyId: f.partyId, driverId: w.driverId, waybillId: w.id, description: `ديزل الشحنة ${w.number}` };
    // كل مدين يقابله دائن بالمبلغ نفسه، فيبقى القيد متوازناً بالريال مهما كان تقريب سعر الصرف
    pair({ accountId: account.fuelCost, ...fx, ...dims, description: `ديزل الشحنة ${w.number}` }, credit, f.amount);
    if (f.vatAmount > 0) {
      pair({ accountId: account.inputVat, ...fx, taxCodeId: inputVatTaxCodeId, waybillId: w.id, description: "ضريبة مدخلات الديزل" }, credit, f.vatAmount);
    }
  }

  if (w.execution === "fleet" && w.driverCommission > 0) {
    if (!w.driverPayableAccountId) throw new Error("السائق بلا حساب رواتب مستحقة");
    pair(
      { accountId: account.driverCommission, ...dims, description: `عمولة السائق – ${w.number}` },
      { accountId: w.driverPayableAccountId, driverId: w.driverId, waybillId: w.id, description: `عمولة الشحنة ${w.number}` },
      w.driverCommission,
    );
  }

  lines.push(...waybillExpenseLines(w, expenses, account));

  if (w.execution === "carrier") {
    if (!w.carrierId || !(w.carrierCost > 0)) throw new Error("أدخل الناقل وتكلفة النقل");
    pair(
      { accountId: account.carrierCost, ...dims, partyId: w.carrierId, description: `ناقل خارجي – ${w.number}` },
      { accountId: account.carriers, partyId: w.carrierId, waybillId: w.id, description: `تكلفة نقل الشحنة ${w.number}` },
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
