// قيد إصدار الفاتورة التجميعية: مدين العميل / دائن الإيراد (سطر لكل بوليصة بمركز تكلفة مركبتها)
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
}

export function invoicePostingLines(
  inv: { number: string; customerId: number; currencyCode: string; exchangeRate: number },
  lines: PostingInvoiceLine[],
  accounts: { receivable: number; outputVat: number },
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
    if (l.amount > 0) {
      out.push(ar(l.amount, l, `فاتورة ${inv.number} – ${l.description}`), {
        accountId: l.accountId,
        credit: l.amount,
        ...fx,
        partyId: inv.customerId,
        costCenterId: l.costCenterId,
        waybillId: l.waybillId,
        description: l.description,
      });
    }
    if (l.vatAmount > 0) {
      out.push(ar(l.vatAmount, l, `ضريبة فاتورة ${inv.number}`), {
        accountId: accounts.outputVat,
        credit: l.vatAmount,
        ...fx,
        partyId: inv.customerId,
        taxCodeId: outputTaxCodeId,
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
