import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { unbilledCharges } from "@/lib/customer-charges";
import { EXPENSE_PAYERS } from "@/data/waybills";
import { WAYBILL_STATUS } from "@/data/waybills";
import { Drill } from "@/components/drill";
import { sourceHref } from "@/lib/source-lines";
import { todayRiyadh } from "@/lib/dates";
import { C, money, ReportHeader, RTable } from "../report-ui";

/** متابعة الحساب 1114: كل مصروف دُفع على عميل ولم يدخل فاتورة صادرة بعد، فلا يضيع مصروف. */
export default async function UnbilledChargesReport() {
  await requirePermission("financial_reports", "view");
  const [rows, [ledger]] = await Promise.all([
    unbilledCharges(db),
    db.execute(sql`select coalesce(sum(l.debit_base - l.credit_base), 0) as balance
      from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted'
      join accounts a on a.id = l.account_id where a.code = '1114'`) as unknown as Promise<{ balance: string }[]>,
  ]);
  const total = rows.reduce((t, r) => t + Number(r.base), 0);
  // ما لم يُقيد بعد (مصروف على شحنة لم تُعتمد) يظهر في القائمة ولا يظهر في رصيد الحساب
  const posted = rows.filter((r) => !r.status || !["draft", "in_transit", "delivered", "rejected"].includes(r.status)).reduce((t, r) => t + Number(r.base), 0);

  return (
    <>
      <ReportHeader title="مصاريف على العملاء لم تُفوتر (1114)" period="حتى اليوم" filename="مصاريف-العملاء-غير-المفوترة" />
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3 print:hidden">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">إجمالي غير المفوتر</div>
          <div className="ltr-nums mt-1 text-xl font-semibold">{money(total, false)}</div>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">منه مقيد (شحنات معتمدة وفواتير مباشرة)</div>
          <div className="ltr-nums mt-1 text-xl font-semibold">{money(posted, false)}</div>
        </div>
        <Drill href={sourceHref({ title: "رصيد الحساب 1114", to: todayRiyadh(), codes: ["=1114"], mode: "bal", sign: 1, expected: Number(ledger?.balance ?? 0) })} card className="block rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">رصيد الحساب 1114 في الدفتر</div>
          <div className="ltr-nums mt-1 text-xl font-semibold">{money(Number(ledger?.balance ?? 0), false)}</div>
        </Drill>
      </div>
      <RTable name="مصاريف على العملاء لم تُفوتر" head={["العميل", "الشحنة", "التاريخ", "الحالة", "المصروف", "دفعه", "المبلغ", "بالريال", "مسودة الفاتورة"]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <C>{r.customer}</C>
            <C>
              <Link href={r.waybillId ? `/waybills/${r.waybillId}` : `/invoices/${r.invoiceId}`} className="ltr-nums text-brand-700 hover:underline">
                {r.waybill}
              </Link>
            </C>
            <C className="ltr-nums">{fmtDate(r.waybillDate)}</C>
            <C>{r.status ? (WAYBILL_STATUS[r.status]?.label ?? r.status) : "فاتورة مباشرة"}</C>
            <C>
              {r.type}
              {r.note && <span className="block text-xs text-gray-500">{r.note}</span>}
            </C>
            <C>{EXPENSE_PAYERS[r.payer as keyof typeof EXPENSE_PAYERS] ?? r.payer}</C>
            <C num>
              {money(Number(r.amount))} {r.currencyCode}
            </C>
            <C num>{money(Number(r.base))}</C>
            <C className="ltr-nums">{r.draftInvoice ? <Drill href={`/go/${encodeURIComponent(r.draftInvoice)}`} tip="افتح مسودة الفاتورة">{r.draftInvoice}</Drill> : "—"}</C>
          </tr>
        ))}
        {!rows.length && (
          <tr>
            <C colSpan={9} className="text-center text-gray-500">
              لا توجد مصاريف على العملاء تنتظر الفوترة
            </C>
          </tr>
        )}
      </RTable>
      <p className="mt-2 text-xs text-gray-500">
        المصروف على العميل يُقيد مديناً على 1114 عند دفعه (أو مع اعتماد الشحنة)، ويُقفل عند إصدار الفاتورة (مدين العميل 1103، دائن 1114). رصيد الحساب يساوي «منه مقيد» ما لم يُقيد على 1114 شيء يدوياً.
      </p>
    </>
  );
}
