import { Fragment } from "react";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { cashFlow } from "@/lib/dashboard";
import { Drill, FormulaDrill } from "@/components/drill";
import { cashDrills } from "@/lib/drill-formulas";
import { C, money, PeriodFilter, periodFrom, ReportHeader, RTable, type ReportParams } from "../report-ui";

/** قائمة التدفق النقدي (الطريقة المباشرة): الداخل والخارج من الصناديق والبنوك مصنّفاً بالحساب المقابل، ورصيد كل صندوق وبنك. */
export default async function CashFlowPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const cf = await cashFlow(db, from, to);
  const d = cashDrills(cf, from, to, (v) => money(v, false));
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
          <C num>
            <Drill href={d.opening}>{money(cf.opening, false)}</Drill>
          </C>
        </tr>
        {cf.sections.map((sec) => (
          <Fragment key={sec.key}>
            <tr className="bg-brand-50/70 font-semibold text-brand-900">
              <C colSpan={4}>{sec.label}</C>
            </tr>
            {sec.items.map((i) => (
              <tr key={i.key}>
                <C className="ps-8">{i.href ? <a href={i.href} className="text-brand-700 hover:underline">{i.label}</a> : i.label}</C>
                <C num>{i.in ? <Drill href={d.item(i, "in")}>{money(i.in)}</Drill> : money(i.in)}</C>
                <C num>{i.out ? <Drill href={d.item(i, "out")}>{money(i.out)}</Drill> : money(i.out)}</C>
                <C num>
                  <Drill href={d.item(i, "net")}>{money(i.net, false)}</Drill>
                </C>
              </tr>
            ))}
            <tr className="font-semibold">
              <C>صافي {sec.label}</C>
              <C />
              <C />
              <C num>
                <Drill href={d.section(sec)}>{money(sec.net, false)}</Drill>
              </C>
            </tr>
          </Fragment>
        ))}
        <tr className="font-semibold">
          <C>صافي التغير في النقد</C>
          <C num>
            <Drill href={d.inflow}>{money(cf.inflow, false)}</Drill>
          </C>
          <C num>
            <Drill href={d.outflow}>{money(cf.outflow, false)}</Drill>
          </C>
          <C num>
            <FormulaDrill formula={d.net}>{money(cf.net, false)}</FormulaDrill>
          </C>
        </tr>
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C>النقد آخر الفترة</C>
          <C />
          <C />
          <C num>
            <FormulaDrill formula={d.closing}>{money(cf.closing, false)}</FormulaDrill>
          </C>
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
            <C num>
              <Drill href={d.account(a, "opening")}>{money(a.opening, false)}</Drill>
            </C>
            <C num>{a.in ? <Drill href={d.account(a, "in")}>{money(a.in)}</Drill> : money(a.in)}</C>
            <C num>{a.out ? <Drill href={d.account(a, "out")}>{money(a.out)}</Drill> : money(a.out)}</C>
            <C num className="font-semibold">
              <Drill href={d.account(a, "closing")}>{money(a.closing, false)}</Drill>
            </C>
          </tr>
        ))}
      </RTable>
      <p className="mt-2 text-xs text-gray-500">التحويل بين الصناديق والبنوك لا يظهر في البنود لأنه لا يغيّر النقد، ويظهر في حركة كل حساب.</p>
    </>
  );
}
