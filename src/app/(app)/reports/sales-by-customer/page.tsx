import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { salesByCustomer } from "@/lib/reports";
import { C, money, PeriodFilter, periodFrom, ReportHeader, RTable, type ReportParams } from "../report-ui";

/** المبيعات حسب العميل: الإيراد والمصاريف المستردة والضريبة من قيود الفوترة والإشعارات. */
export default async function SalesByCustomerPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const rows = await salesByCustomer(db, from, to);
  const sum = (k: "invoices" | "revenue" | "recharged" | "vat" | "total") => rows.reduce((a, r) => a + r[k], 0);
  const total = sum("total");
  return (
    <>
      <ReportHeader title="المبيعات حسب العميل" period={`من ${from} إلى ${to}`} filename={`المبيعات-حسب-العميل-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today} />
      </ReportHeader>
      <RTable name="المبيعات حسب العميل" head={["العميل", "الفواتير", "الإيراد", "مصاريف مستردة", "الضريبة", "الإجمالي", "النسبة"]}>
        {rows.length === 0 && (
          <tr>
            <C colSpan={7} className="py-8 text-center text-gray-500">
              لا مبيعات في هذه الفترة
            </C>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.id}>
            <C>
              <a href={`/reports/party-statement?party=${r.id}&from=${from}&to=${to}`} className="text-brand-700 hover:underline">
                {r.name}
              </a>
            </C>
            <C num>{r.invoices || "—"}</C>
            <C num>{money(r.revenue)}</C>
            <C num>{money(r.recharged)}</C>
            <C num>{money(r.vat)}</C>
            <C num className="font-semibold">
              {money(r.total)}
            </C>
            <C num className="text-gray-500">
              {total ? `${((r.total / total) * 100).toFixed(1)}%` : "—"}
            </C>
          </tr>
        ))}
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C>الإجمالي</C>
          <C num>{sum("invoices")}</C>
          <C num>{money(sum("revenue"), false)}</C>
          <C num>{money(sum("recharged"), false)}</C>
          <C num>{money(sum("vat"), false)}</C>
          <C num>{money(total, false)}</C>
          <C />
        </tr>
      </RTable>
      <p className="mt-2 text-xs text-gray-500">الإيراد من حسابات 4xxx بعد الإشعارات الدائنة والمدينة، والمصاريف المستردة ما فُوتر من 1114، والضريبة من 2109.</p>
    </>
  );
}
