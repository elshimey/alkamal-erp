import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { purchasesBySupplier } from "@/lib/reports";
import { C, money, PeriodFilter, periodFrom, ReportHeader, RTable, type ReportParams } from "../report-ui";

/** المشتريات حسب المورد: ما قُيد على ذمة كل مورد (فواتير، صيانة آجلة، مصروفات مستحقة) دون السداد، وضريبتها. */
export default async function PurchasesBySupplierPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const rows = await purchasesBySupplier(db, from, to);
  const sum = (k: "bills" | "net" | "vat" | "total") => rows.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <ReportHeader title="المشتريات حسب المورد" period={`من ${from} إلى ${to}`} filename={`المشتريات-حسب-المورد-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today} />
      </ReportHeader>
      <RTable name="المشتريات حسب المورد" head={["المورد", "فواتير الموردين", "قبل الضريبة", "الضريبة", "الإجمالي"]}>
        {rows.length === 0 && (
          <tr>
            <C colSpan={5} className="py-8 text-center text-gray-500">
              لا مشتريات في هذه الفترة
            </C>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.id}>
            <C>
              <a href={`/reports/party-statement?side=supplier&party=${r.id}&from=${from}&to=${to}`} className="text-brand-700 hover:underline">
                {r.name}
              </a>
            </C>
            <C num>{r.bills || "—"}</C>
            <C num>{money(r.net)}</C>
            <C num>{money(r.vat)}</C>
            <C num className="font-semibold">
              {money(r.total)}
            </C>
          </tr>
        ))}
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C>الإجمالي</C>
          <C num>{sum("bills")}</C>
          <C num>{money(sum("net"), false)}</C>
          <C num>{money(sum("vat"), false)}</C>
          <C num>{money(sum("total"), false)}</C>
        </tr>
      </RTable>
      <p className="mt-2 text-xs text-gray-500">من ذمم الموردين 2101–2105 دون سندات الصرف، والضريبة من 1108 على سطور المورد. المشتريات النقدية دون مورد لا تظهر هنا (انظر المصروفات).</p>
    </>
  );
}
