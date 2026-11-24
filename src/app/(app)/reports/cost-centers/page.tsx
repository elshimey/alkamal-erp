import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { costCenterProfit } from "@/lib/reports";
import { Drill, FormulaDrill, type Formula } from "@/components/drill";
import { periodSource } from "@/lib/drill-formulas";
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
  // «مصدر الرقم»: قيود المركز (0 = أي مركز) بنفس الفترة، والربح والهامش معادلتان
  const per = `من ${from} إلى ${to}`;
  const src = periodSource(from, to);
  type V = { revenue: number; direct: number; other: number; profit: number };
  const h = (id: number, name: string, label: string, codes: string[], sign: 1 | -1, expected: number) => src({ title: `${name}: ${label}`, codes, costCenterId: id, sign, expected });
  const cells = (id: number, name: string, v: V) => ({
    revenue: h(id, name, "الإيرادات", ["4"], -1, v.revenue),
    direct: h(id, name, "تكلفة مباشرة", ["5"], 1, v.direct),
    other: h(id, name, "مصروفات أخرى", ["6", "7"], 1, v.other),
  });
  const profitF = (id: number, name: string, v: V): Formula => {
    const c = cells(id, name, v);
    return {
      title: `صافي ربح ${name}`,
      value: money(v.profit, false),
      period: per,
      rows: [
        { label: "الإيرادات", note: "حسابات 4", value: money(v.revenue, false), href: c.revenue },
        { op: "−", label: "تكلفة مباشرة", note: "حسابات 5", value: money(v.direct, false), href: c.direct },
        { op: "−", label: "مصروفات أخرى", note: "حسابات 6 و7", value: money(v.other, false), href: c.other },
      ],
      allHref: h(id, name, "صافي الربح", ["4", "5", "6", "7"], -1, v.profit),
    };
  };
  const marginF = (id: number, name: string, v: V, pct: string): Formula => ({
    title: `هامش ${name}`,
    value: pct,
    period: per,
    rows: [
      { label: "صافي الربح", value: money(v.profit, false), formula: profitF(id, name, v) },
      { op: "÷", label: "الإيرادات", value: money(v.revenue, false), href: cells(id, name, v).revenue },
    ],
  });
  const all = cells(0, "كل المراكز", t);

  return (
    <>
      <ReportHeader title="ربحية المركبات ومراكز التكلفة" period={`من ${from} إلى ${to}`} filename={`ربحية-المراكز-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today} />
      </ReportHeader>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4 print:hidden">
        {[
          { label: "الإيرادات", v: money(t.revenue, false), href: all.revenue },
          { label: "التكاليف المباشرة", v: money(t.direct, false), href: all.direct },
          { label: "صافي الربح", v: money(t.profit, false), strong: true, formula: profitF(0, "كل المراكز", t) },
          { label: "الأعلى ربحاً", v: best ? best.name : "—", small: true, formula: best ? profitF(best.id, best.name, best) : undefined },
        ].map((k) => {
          const inner = (
            <>
              <div className={`text-xs ${k.strong ? "text-white/70" : "text-gray-500"}`}>{k.label}</div>
              <div className={`mt-1 font-semibold ${k.small ? "text-base" : "ltr-nums text-xl"}`}>{k.v}</div>
            </>
          );
          const cls = `block rounded-2xl p-4 shadow-sm ${k.strong ? "bg-asphalt-900 text-white" : "bg-white"}`;
          return k.formula ? (
            <FormulaDrill key={k.label} formula={k.formula} card className={cls}>
              {inner}
            </FormulaDrill>
          ) : (
            <Drill key={k.label} href={k.href} card className={cls}>
              {inner}
            </Drill>
          );
        })}
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
            <C num>{r.revenue ? <Drill href={cells(r.id, r.name, r).revenue}>{money(r.revenue)}</Drill> : "—"}</C>
            <C num>{r.direct ? <Drill href={cells(r.id, r.name, r).direct}>{money(r.direct)}</Drill> : "—"}</C>
            <C num>{r.other ? <Drill href={cells(r.id, r.name, r).other}>{money(r.other)}</Drill> : "—"}</C>
            <C num className={`font-semibold ${r.profit < 0 ? "text-red-600" : "text-green-700"}`}>
              <FormulaDrill formula={profitF(r.id, r.name, r)}>{money(r.profit)}</FormulaDrill>
            </C>
            <C num>
              {r.margin !== null && r.revenue ? (
                <FormulaDrill formula={marginF(r.id, r.name, r, `${r.margin.toFixed(1)}%`)} className="inline-flex items-center gap-2">
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 sm:inline-block print:hidden">
                    <span className={`block h-full ${r.margin < 0 ? "bg-red-500" : "bg-brand-500"}`} style={{ width: `${Math.min(100, Math.abs(r.margin))}%` }} />
                  </span>
                  {r.margin.toFixed(1)}%
                </FormulaDrill>
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
            <C num>
              <Drill href={all.revenue}>{money(t.revenue, false)}</Drill>
            </C>
            <C num>
              <Drill href={all.direct}>{money(t.direct, false)}</Drill>
            </C>
            <C num>
              <Drill href={all.other}>{money(t.other, false)}</Drill>
            </C>
            <C num>
              <FormulaDrill formula={profitF(0, "كل المراكز", t)}>{money(t.profit, false)}</FormulaDrill>
            </C>
            <C num>{t.revenue ? <FormulaDrill formula={marginF(0, "كل المراكز", t, `${((t.profit / t.revenue) * 100).toFixed(1)}%`)}>{`${((t.profit / t.revenue) * 100).toFixed(1)}%`}</FormulaDrill> : "—"}</C>
          </tr>
        )}
      </RTable>
      <p className="mt-2 text-xs text-gray-500">
        التكلفة المباشرة: حسابات تكلفة الإيرادات (5). المصروفات الأخرى: الإدارية والتمويلية المحمّلة على المركز. اضغط اسم المركز لعرض ميزان مراجعته.
      </p>
    </>
  );
}
