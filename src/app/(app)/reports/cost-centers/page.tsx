import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { costCenterProfit } from "@/lib/reports";
import { C, money, PeriodFilter, periodFrom, ReportHeader, RTable } from "../report-ui";

const TYPES: Record<string, string> = { vehicle: "مركبة", admin: "إدارة", workshop: "ورشة", other: "أخرى" };

export default async function CostCentersReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("financial_reports", "view");
  const today = todayRiyadh();
  const { from, to } = periodFrom(await searchParams, today);
  const rows = (await costCenterProfit(db, from, to)).filter((r) => r.revenue || r.direct || r.other);
  const t = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, direct: a.direct + r.direct, other: a.other + r.other, profit: a.profit + r.profit }), {
    revenue: 0,
    direct: 0,
    other: 0,
    profit: 0,
  });
  const best = [...rows].filter((r) => r.revenue > 0).sort((a, b) => b.profit - a.profit)[0];
  const ledgerHref = (id: number) => `/reports/trial-balance?cc=${id}&from=${from}&to=${to}`;

  return (
    <>
      <ReportHeader title="ربحية المركبات ومراكز التكلفة" period={`من ${from} إلى ${to}`} filename={`ربحية-المراكز-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today} />
      </ReportHeader>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4 print:hidden">
        {[
          { label: "الإيرادات", v: money(t.revenue, false) },
          { label: "التكاليف المباشرة", v: money(t.direct, false) },
          { label: "صافي الربح", v: money(t.profit, false), strong: true },
          { label: "الأعلى ربحاً", v: best ? best.name : "—", small: true },
        ].map((k) => (
          <div key={k.label} className={`rounded-2xl p-4 shadow-sm ${k.strong ? "bg-asphalt-900 text-white" : "bg-white"}`}>
            <div className={`text-xs ${k.strong ? "text-white/70" : "text-gray-500"}`}>{k.label}</div>
            <div className={`mt-1 font-semibold ${k.small ? "text-base" : "ltr-nums text-xl"}`}>{k.v}</div>
          </div>
        ))}
      </div>
      <RTable name="ربحية مراكز التكلفة" head={["الرمز", "المركز", "النوع", "الإيرادات", "تكلفة مباشرة", "مصروفات أخرى", "صافي الربح", "الهامش"]}>
        {rows.length === 0 && (
          <tr>
            <C className="py-8 text-center text-gray-500" colSpan={8}>
              لا توجد حركة على مراكز التكلفة في هذه الفترة.
            </C>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.id}>
            <C className="ltr-nums text-gray-500">{r.code}</C>
            <C>
              <a href={ledgerHref(r.id)} className="text-brand-700 hover:underline">
                {r.name}
              </a>
            </C>
            <C className="text-xs text-gray-500">{TYPES[r.type] ?? r.type}</C>
            <C num>{money(r.revenue)}</C>
            <C num>{money(r.direct)}</C>
            <C num>{money(r.other)}</C>
            <C num className={`font-semibold ${r.profit < 0 ? "text-red-600" : "text-green-700"}`}>{money(r.profit)}</C>
            <C num>
              {r.margin !== null && r.revenue ? (
                <span className="inline-flex items-center gap-2">
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 sm:inline-block print:hidden">
                    <span className={`block h-full ${r.margin < 0 ? "bg-red-500" : "bg-brand-500"}`} style={{ width: `${Math.min(100, Math.abs(r.margin))}%` }} />
                  </span>
                  {r.margin.toFixed(1)}%
                </span>
              ) : (
                "—"
              )}
            </C>
          </tr>
        ))}
        {rows.length > 0 && (
          <tr className="bg-asphalt-900 font-bold text-white print:bg-white print:text-black">
            <C />
            <C>الإجمالي</C>
            <C />
            <C num>{money(t.revenue, false)}</C>
            <C num>{money(t.direct, false)}</C>
            <C num>{money(t.other, false)}</C>
            <C num>{money(t.profit, false)}</C>
            <C num>{t.revenue ? `${((t.profit / t.revenue) * 100).toFixed(1)}%` : "—"}</C>
          </tr>
        )}
      </RTable>
      <p className="mt-2 text-xs text-gray-500">
        التكلفة المباشرة: حسابات تكلفة الإيرادات (5). المصروفات الأخرى: الإدارية والتمويلية المحمّلة على المركز. اضغط اسم المركز لعرض ميزان مراجعته.
      </p>
    </>
  );
}
