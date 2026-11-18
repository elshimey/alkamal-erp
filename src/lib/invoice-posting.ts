// قيد إصدار الفاتورة التجميعية: مدين العميل / دائن الإيراد (سطر لكل شحنة بمركز تكلفة مركبتها)
// والمصاريف المستردة وضريبة المخرجات. كل دائن يقابله مدين للعميل بالمبلغ نفسه، فيبقى القيد
// متوازناً بالريال حتى مع تقريب سعر صرف الدينار.
import type { LineInput } from "@/lib/ledger";

export interface PostingInvoiceLine {
  accountId: number;
  amount: number;
  vatAmount: number;
  costCenterId: number | null;
  waybillId: number | null;
  description: string;
  /** نوع ضريبة السطر (يُسجل على سطر ضريبة المخرجات) */
  taxCodeId?: number | null;
  /** للمصروف المسترد: تكلفته؛ ما يزيد عليها يُقيد إيراداً على حساب الهامش */
  costAmount?: number | null;
}

export function invoicePostingLines(
  inv: { number: string; customerId: number; currencyCode: string; exchangeRate: number },
  lines: PostingInvoiceLine[],
  accounts: { receivable: number; outputVat: number; markup?: number },
  outputTaxCodeId: number | null,
): LineInput[] {
  const fx = { currencyCode: inv.currencyCode, exchangeRate: inv.exchangeRate };
  const out: LineInput[] = [];
  const ar = (amount: number, l: PostingInvoiceLine, description: string): LineInput => ({
    accountId: accounts.receivable,
    debit: amount,
    ...fx,
    partyId: inv.customerId,
    waybillId: l.waybillId,
    description,
  });
  for (const l of lines) {
    // المصروف المسترد: تكلفته تُقفل حسابه (1114)، والزيادة عليها إيراد
    const cost = l.costAmount != null && accounts.markup ? Math.min(l.amount, l.costAmount) : l.amount;
    const markup = round2(l.amount - cost);
    if (cost > 0) {
      out.push(ar(cost, l, `فاتورة ${inv.number} – ${l.description}`), {
        accountId: l.accountId,
        credit: cost,
        ...fx,
        partyId: inv.customerId,
        costCenterId: l.costCenterId,
        waybillId: l.waybillId,
        description: l.description,
      });
    }
    if (markup > 0 && accounts.markup) {
      out.push(ar(markup, l, `فاتورة ${inv.number} – ${l.description}`), {
        accountId: accounts.markup,
        credit: markup,
        ...fx,
        partyId: inv.customerId,
        waybillId: l.waybillId,
        description: `هامش على ${l.description}`,
      });
    }
    if (l.vatAmount > 0) {
      out.push(ar(l.vatAmount, l, `ضريبة فاتورة ${inv.number}`), {
        accountId: accounts.outputVat,
        credit: l.vatAmount,
        ...fx,
        partyId: inv.customerId,
        taxCodeId: l.taxCodeId ?? outputTaxCodeId,
        waybillId: l.waybillId,
        description: `ضريبة مخرجات – ${l.description}`,
      });
    }
  }
  return out;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** ضريبة السطر بنسبة رمز الضريبة، مقرّبة لهللتين. */
export const lineVat = (amount: number, ratePercent: number) => round2((amount * ratePercent) / 100);
