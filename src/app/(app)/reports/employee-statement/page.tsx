import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { accountLedger } from "@/lib/reports";
import { employeeOptions } from "@/lib/lookups";
import { FormCombo } from "@/components/form-combo";
import { Drill } from "@/components/drill";
import { sourceHref } from "@/lib/source-lines";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, RTable, SourceLink, type ReportParams } from "../report-ui";

/**
 * كشف حساب موظف: حساب راتبه المستحق (2107…: الراتب والعمولات والخصومات والصرف) وحساب عهدته (1105…)،
 * كلٌّ بحركاته ورصيده. السائق عهدته حساب سجله في السائقين.
 */
export default async function EmployeeStatementPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const employeeId = Number(param(sp, "employee")) || null;
  const [options, emp] = await Promise.all([
    employeeOptions(),
    employeeId
      ? db
          .select({ name: s.employees.nameAr, payable: s.employees.payableAccountId, custody: s.employees.custodyAccountId, driverCustody: s.drivers.custodyAccountId })
          .from(s.employees)
          .leftJoin(s.drivers, eq(s.drivers.employeeId, s.employees.id))
          .where(eq(s.employees.id, employeeId))
          .then((r) => r[0])
      : null,
  ]);
  const accountIds = emp ? [emp.payable, emp.driverCustody ?? emp.custody].filter((x): x is number => !!x) : [];
  const ledgers = await Promise.all(accountIds.map((accountId) => accountLedger(db, { accountId, from, to })));
  const dayBefore = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  return (
    <>
      <ReportHeader title={emp ? `كشف حساب الموظف: ${emp.name}` : "كشف حساب موظف وعهدته"} period={`من ${from} إلى ${to}`} filename={`كشف-موظف-${emp?.name ?? ""}-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">الموظف</span>
            <div className="w-72 max-w-full">
              <FormCombo name="employee" options={options} defaultValue={employeeId ? String(employeeId) : ""} required placeholder="اكتب اسم الموظف أو السائق…" />
            </div>
          </label>
        </PeriodFilter>
      </ReportHeader>
      {!emp ? (
        <p className="rounded-2xl bg-white p-8 text-center text-gray-500 shadow-sm">اختر موظفاً أو سائقاً لعرض حساب راتبه وعهدته.</p>
      ) : ledgers.length === 0 ? (
        <p className="rounded-2xl bg-white p-8 text-center text-gray-500 shadow-sm">لا حساب راتب أو عهدة لهذا الموظف بعد (يُفتح مع أول مسير أو عهدة).</p>
      ) : (
        ledgers.map((l) => {
          const payable = l.account.code.startsWith("2");
          const k = payable ? -1 : 1;
          return (
            <section key={l.account.id} className="mb-8 print:break-inside-auto">
              <h2 className="mb-1 text-base font-semibold text-brand-900">
                {payable ? "الراتب المستحق" : "العهدة"} · <span className="ltr-nums">{l.account.code}</span> {l.account.nameAr}
              </h2>
              <p className="mb-3 text-xs text-gray-500">{payable ? "الرصيد = ما تستحقه للموظف (رواتب وعمولات لم تُصرف)." : "الرصيد = ما عند الموظف من نقد الشركة؛ السالب صرفه من جيبه ويستحق تعويضاً."}</p>
              <RTable name={payable ? "الراتب المستحق" : "العهدة"} head={["التاريخ", "المستند", "القيد", "البيان", "مدين", "دائن", "الرصيد"]}>
                <tr className="bg-gray-50 font-semibold">
                  <C className="ltr-nums">{from}</C>
                  <C />
                  <C />
                  <C>رصيد افتتاحي</C>
                  <C />
                  <C />
                  <C num>
                    <Drill href={sourceHref({ title: `${l.account.code} ${l.account.nameAr}: رصيد افتتاحي`, to: dayBefore, codes: [`=${l.account.code}`], mode: "bal", sign: k as 1 | -1, expected: l.opening * k })}>{money(l.opening * k, false)}</Drill>
                  </C>
                </tr>
                {l.lines.map((x, i) => (
                  <tr key={i}>
                    <C className="ltr-nums whitespace-nowrap">{x.entry_date}</C>
                    <C className="text-xs whitespace-nowrap">
                      <SourceLink type={x.source_type} id={x.source_id} entryId={x.entry_id} />
                    </C>
                    <C className="ltr-nums text-xs text-gray-500"><a href={`/journal/${x.entry_id}`} className="drill">{x.number}</a></C>
                    <C className="max-w-md">{x.description ?? x.entry_description}</C>
                    <C num>{money(x.debit)}</C>
                    <C num>{money(x.credit)}</C>
                    <C num className="font-medium">
                      {money(x.balance * k, false)}
                    </C>
                  </tr>
                ))}
                <tr className="bg-asphalt-900/5 font-bold text-brand-900">
                  <C />
                  <C />
                  <C />
                  <C>الإجمالي والرصيد الختامي</C>
                  <C num>{money(l.debit, false)}</C>
                  <C num>{money(l.credit, false)}</C>
                  <C num>{money(l.closing * k, false)}</C>
                </tr>
              </RTable>
            </section>
          );
        })
      )}
    </>
  );
}
