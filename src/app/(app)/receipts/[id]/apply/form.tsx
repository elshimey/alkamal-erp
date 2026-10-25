"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyAdvanceAction } from "../../actions";
import { fmt } from "@/lib/format";
import { DateInput } from "@/components/date-input";

type Inv = { id: number; number: string; invoiceDate: string; dueDate: string; total: string; paid: string };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function ApplyForm({ receiptId, remaining, invoices, today, minDate, posted }: { receiptId: number; remaining: number; invoices: Inv[]; today: string; minDate: string; posted: boolean }) {
  const router = useRouter();
  const [date, setDate] = useState(today < minDate ? minDate : today);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const bal = (i: Inv) => r2(Number(i.total) - Number(i.paid));
  const total = r2(Object.values(amounts).reduce((t, v) => t + (Number(v) || 0), 0));
  const over = total > remaining + 0.005 || invoices.some((i) => (Number(amounts[i.id]) || 0) > bal(i) + 0.005);

  const auto = () => {
    let left = remaining;
    setAmounts(Object.fromEntries(invoices.map((i) => {
      const take = r2(Math.max(0, Math.min(left, bal(i))));
      left = r2(left - take);
      return [i.id, take ? String(take) : ""];
    })));
  };
  const submit = () =>
    start(async () => {
      setError("");
      const res = await applyAdvanceAction(
        receiptId,
        Object.entries(amounts).map(([k, v]) => ({ invoiceId: Number(k), amount: Number(v) || 0 })).filter((a) => a.amount > 0),
        date,
      );
      if (res.error) setError(res.error);
      else router.push(`/receipts?open=${receiptId}`);
    });

  if (!posted) return <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">رحّل الدفعة المقدمة أولاً ثم طبّقها على الفواتير.</p>;
  return (
    <div className="max-w-3xl rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          تاريخ التطبيق
          <DateInput value={date} min={minDate} onChange={(e) => setDate(e.target.value)} className="ltr-nums h-9 rounded-lg border border-gray-300 px-2" />
        </label>
        <button type="button" onClick={auto} disabled={!invoices.length} className="ms-auto text-xs text-brand-700 hover:underline disabled:text-gray-300">
          توزيع تلقائي
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b text-xs text-gray-500">
          <tr>
            <th className="py-2 text-start font-medium">فاتورة</th>
            <th className="py-2 text-start font-medium">الاستحقاق</th>
            <th className="py-2 text-end font-medium">الرصيد</th>
            <th className="w-40 py-2 text-end font-medium">المبلغ المطبق</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {!invoices.length && (
            <tr>
              <td colSpan={4} className="py-8 text-center text-gray-400">لا توجد فواتير مفتوحة لهذا العميل بنفس العملة</td>
            </tr>
          )}
          {invoices.map((i) => (
            <tr key={i.id}>
              <td className="ltr-nums py-2 font-medium">{i.number}</td>
              <td className="ltr-nums py-2 text-gray-600">{i.dueDate}</td>
              <td className="ltr-nums py-2 text-end">{fmt(bal(i))}</td>
              <td className="py-1.5">
                <input
                  value={amounts[i.id] ?? ""}
                  inputMode="decimal"
                  onChange={(e) => setAmounts({ ...amounts, [i.id]: e.target.value })}
                  className="ltr-nums h-9 w-full rounded-lg border border-gray-300 px-2 text-end"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
        <span>
          المطبق <b className="ltr-nums">{fmt(total)}</b> من <span className="ltr-nums">{fmt(remaining)}</span>
          {over && <span className="ms-2 text-xs text-red-700">أكبر من المتاح أو من رصيد فاتورة</span>}
        </span>
        <button type="button" onClick={submit} disabled={pending || !total || over} className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 disabled:opacity-50">
          تطبيق
        </button>
      </div>
    </div>
  );
}
