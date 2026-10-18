import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { presetRanges, vatReturn } from "@/lib/reports";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, RTable } from "../report-ui";

export default async function VatReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  // الإقرار ربع سنوي، فالافتراضي هو الربع الحالي.
  const quarter = presetRanges(today).find((p) => p.key === "quarter")!;
  const { from, to } = param(sp, "from") ? periodFrom(sp, today) : quarter;
  const v = await vatReturn(db, from, to);
  const due = v.net >= 0;

  return (
    <>
      <ReportHeader title="إقرار ضريبة القيمة المضافة" period={`من ${from} إلى ${to}`} filename={`إقرار-الضريبة-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today} />
      </ReportHeader>
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3 print:hidden">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">ضريبة المخرجات (المبيعات)</div>
          <div className="ltr-nums mt-1 text-xl font-semibold">{money(v.output, false)}</div>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">ضريبة المدخلات (المشتريات)</div>
          <div className="ltr-nums mt-1 text-xl font-semibold">{money(v.input, false)}</div>
        </div>
        <div className={`rounded-2xl p-4 shadow-sm ${due ? "bg-asphalt-900 text-white" : "bg-green-700 text-white"}`}>
          <div className="text-xs text-white/70">{due ? "صافي الضريبة المستحقة للسداد" : "صافي الضريبة القابلة للاسترداد"}</div>
          <div className="ltr-nums mt-1 text-xl font-semibold">{money(Math.abs(v.net), false)}</div>
        </div>
      </div>
      <RTable name="إقرار ضريبة القيمة المضافة" head={["#", "البند", "المبلغ (ريال)", "التعديلات", "ضريبة القيمة المضافة"]}>
        <tr className="bg-gray-100 font-bold">
          <C />
          <C>المبيعات</C>
          <C />
          <C />
          <C />
        </tr>
        <tr>
          <C className="ltr-nums text-gray-500">1</C>
          <C>المبيعات الخاضعة للنسبة الأساسية 15%</C>
          <C num>{money(v.standardSales)}</C>
          <C num>—</C>
          <C num>{money(v.standardSalesVat)}</C>
        </tr>
        <tr>
          <C className="ltr-nums text-gray-500">2</C>
          <C>الصادرات والنقل الدولي (نسبة صفرية)</C>
          <C num>{money(v.zeroRatedSales)}</C>
          <C num>—</C>
          <C num>—</C>
        </tr>
        <tr className="font-semibold">
          <C />
          <C>إجمالي المبيعات وضريبة المخرجات</C>
          <C num>{money(v.standardSales + v.zeroRatedSales, false)}</C>
          <C />
          <C num>{money(v.output, false)}</C>
        </tr>
        <tr className="bg-gray-100 font-bold">
          <C />
          <C>المشتريات</C>
          <C />
          <C />
          <C />
        </tr>
        <tr>
          <C className="ltr-nums text-gray-500">3</C>
          <C>المشتريات الخاضعة للنسبة الأساسية 15%</C>
          <C num>{money(v.standardPurchases)}</C>
          <C num>—</C>
          <C num>{money(v.input)}</C>
        </tr>
        <tr className="font-semibold">
          <C />
          <C>إجمالي ضريبة المدخلات</C>
          <C num>{money(v.standardPurchases, false)}</C>
          <C />
          <C num>{money(v.input, false)}</C>
        </tr>
        <tr className="bg-asphalt-900 font-bold text-white print:bg-white print:text-black">
          <C />
          <C>{due ? "صافي الضريبة المستحقة" : "صافي الضريبة القابلة للاسترداد"}</C>
          <C />
          <C />
          <C num>{money(Math.abs(v.net), false)}</C>
        </tr>
      </RTable>
      <p className="mt-2 text-xs text-gray-500">
        ضريبة المخرجات من حساب ضريبة المخرجات (2109) وضريبة المدخلات من حساب ضريبة المدخلات (1108) بعد القيود المرحّلة فقط. وعاء المشتريات محسوب من الضريبة بنسبة 15%.
      </p>
    </>
  );
}
