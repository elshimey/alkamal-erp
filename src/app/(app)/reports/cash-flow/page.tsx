import { Fragment } from "react";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { cashFlow } from "@/lib/dashboard";
import { C, money, PeriodFilter, periodFrom, ReportHeader, RTable, type ReportParams } from "../report-ui";

/** قائمة التدفق النقدي (الطريقة المباشرة): الداخل والخارج من الصناديق والبنوك مصنّفاً بالحساب المقابل، ورصيد كل صندوق وبنك. */
export default async function CashFlowPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const cf = await cashFlow(db, from, to);
  return (
    <>
      <ReportHeader title="التدفق النقدي" period={`من ${from} إلى ${to}`} filename={`التدفق-النقدي-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today} />
      </ReportHeader>
      <RTable name="التدفق النقدي" head={["البند", "داخل", "خارج", "الصافي"]}>
        <tr className="bg-gray-50 font-semibold">
          <C>النقد أول الفترة</C>
          <C />
          <C />
          <C num>{money(cf.opening, false)}</C>
        </tr>
        {cf.sections.map((sec) => (
          <Fragment key={sec.key}>
            <tr className="bg-brand-50/70 font-semibold text-brand-900">
              <C colSpan={4}>{sec.label}</C>
            </tr>
            {sec.items.map((i) => (
              <tr key={i.key}>
                <C className="ps-8">{i.href ? <a href={i.href} className="text-brand-700 hover:underline">{i.label}</a> : i.label}</C>
                <C num>{money(i.in)}</C>
                <C num>{money(i.out)}</C>
                <C num>{money(i.net, false)}</C>
              </tr>
            ))}
            <tr className="font-semibold">
              <C>صافي {sec.label}</C>
              <C />
              <C />
              <C num>{money(sec.net, false)}</C>
            </tr>
          </Fragment>
        ))}
        <tr className="font-semibold">
          <C>صافي التغير في النقد</C>
          <C num>{money(cf.inflow, false)}</C>
          <C num>{money(cf.outflow, false)}</C>
          <C num>{money(cf.net, false)}</C>
        </tr>
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C>النقد آخر الفترة</C>
          <C />
          <C />
          <C num>{money(cf.closing, false)}</C>
        </tr>
      </RTable>

      <h2 className="mt-8 mb-3 text-base font-semibold text-brand-900 print:mt-4">الصناديق والبنوك</h2>
      <RTable name="الصناديق والبنوك" head={["الحساب", "أول الفترة", "داخل", "خارج", "آخر الفترة"]}>
        {cf.accounts.map((a) => (
          <tr key={a.id}>
            <C>
              <a href={`/reports/ledger?account=${a.id}&from=${from}&to=${to}`} className="text-brand-700 hover:underline">
                <span className="ltr-nums">{a.code}</span> {a.name}
              </a>
            </C>
            <C num>{money(a.opening, false)}</C>
            <C num>{money(a.in)}</C>
            <C num>{money(a.out)}</C>
            <C num className="font-semibold">
              {money(a.closing, false)}
            </C>
          </tr>
        ))}
      </RTable>
      <p className="mt-2 text-xs text-gray-500">التحويل بين الصناديق والبنوك لا يظهر في البنود لأنه لا يغيّر النقد، ويظهر في حركة كل حساب.</p>
    </>
  );
}
