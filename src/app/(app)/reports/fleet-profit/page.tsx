import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { driverOptions, vehicleOptions } from "@/lib/lookups";
import { fleetProfitability, type FleetBy } from "@/lib/reports";
import { MultiCheck } from "@/components/multi-check";
import { Drill, FormulaDrill, type Formula } from "@/components/drill";
import { periodSource } from "@/lib/drill-formulas";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, ReportTabs, RTable, withParams, type ReportParams } from "../report-ui";

/**
 * ربحية المركبات والسائقين (الخطوة 5): عمود لكل حساب تكلفة مباشرة فيه أرقام، و«مصاريف أخرى» تتفتح تفاصيلها،
 * وعدد الرحلات، وعرض السائق يضيف مساراته وعملاءه. فلتر لعدة مركبات أو سائقين بمربعات تحديد (لا شيء = الكل).
 */
export default async function FleetProfitPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const by: FleetBy = param(sp, "by") === "driver" ? "driver" : "vehicle";
  // id=4,9,12 (القديم id=4 يعمل كما هو)
  const ids = [...new Set((param(sp, "id") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const [options, { columns, rows }] = await Promise.all([by === "vehicle" ? vehicleOptions() : driverOptions(), fleetProfitability(db, { from, to, by, ids })]);
  const one = by === "vehicle" ? "المركبة" : "السائق";
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const total = { trips: sum((r) => r.trips), revenue: sum((r) => r.revenue), direct: sum((r) => r.directTotal), other: sum((r) => r.otherTotal), profit: sum((r) => r.profit) };
  const names = ids.map((i) => options.find((o) => o.value === String(i))?.label).filter(Boolean) as string[];
  const selected = names.length === 0 ? null : names.length <= 3 ? names.join("، ") : `${names.slice(0, 3).join("، ")} و${names.length - 3} أخرى`;
  // «مصدر الرقم»: كل خانة تفتح قيودها بنفس نسبة التقرير (مركز تكلفة المركبة، أو سائق السطر ثم الشحنة ثم الإسناد)
  const per = `من ${from} إلى ${to}`;
  const src = periodSource(from, to);
  type R = (typeof rows)[number];
  const scope = (r: R | null) => (r == null ? { fleet: (by === "vehicle" ? "v" : "d") as "v" | "d" } : by === "vehicle" ? { vehicleId: r.id ?? undefined } : { driverId: r.id ?? 0, fleet: "d" as const });
  const who = (r: R | null) => (r == null ? "الإجمالي" : r.name);
  const cell = (r: R | null, label: string, codes: string[], sign: 1 | -1, expected: number) => src({ title: `${who(r)}: ${label}`, codes, sign, expected, ...scope(r) });
  const profitF = (r: R | null, v: { revenue: number; direct: number; other: number; profit: number }): Formula => ({
    title: `صافي ربح ${who(r)}`,
    value: money(v.profit),
    period: per,
    rows: [
      { label: "الإيرادات", note: "حسابات 4", value: money(v.revenue), href: cell(r, "الإيرادات", ["4"], -1, v.revenue) },
      { op: "−", label: "التكاليف المباشرة", note: "حسابات 5", value: money(v.direct), href: cell(r, "التكاليف المباشرة", ["5"], 1, v.direct) },
      { op: "−", label: "مصاريف أخرى", note: "حسابات 6 و7", value: money(v.other), href: cell(r, "مصاريف أخرى", ["6", "7"], 1, v.other) },
    ],
    allHref: cell(r, "صافي الربح", ["4", "5", "6", "7"], -1, v.profit),
  });
  const marginF = (r: R | null, v: { revenue: number; direct: number; other: number; profit: number }, pct: string): Formula => ({
    title: `هامش ${who(r)}`,
    value: pct,
    period: per,
    rows: [
      { label: "صافي الربح", value: money(v.profit), formula: profitF(r, v) },
      { op: "÷", label: "الإيرادات", value: money(v.revenue), href: cell(r, "الإيرادات", ["4"], -1, v.revenue) },
    ],
  });
  const tripsHref = (r: R) => (r.id != null && r.trips ? `/waybills?q=${encodeURIComponent(r.name)}&from=${from}&to=${to}` : undefined);
  const head = [one, "الرحلات", "الإيرادات", ...columns.map((c) => c.name), "مصاريف أخرى", "إجمالي التكاليف", "صافي الربح", "الهامش", ...(by === "driver" ? ["المسارات والعملاء"] : [])];

  return (
    <>
      <ReportHeader
        title={`ربحية ${by === "vehicle" ? "المركبات" : "السائقين"}${selected ? `: ${selected}` : ""}`}
        period={`من ${from} إلى ${to}`}
        filename={`ربحية-${by === "vehicle" ? "المركبات" : "السائقين"}-${from}-${to}`}
        wide
      >
        <PeriodFilter from={from} to={to} today={today}>
          <input type="hidden" name="by" value={by} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">{by === "vehicle" ? "المركبات" : "السائقون"} (اختياري)</span>
            <div className="w-64 max-w-full">
              <MultiCheck key={by} name="id" options={options} defaultValue={ids.map(String)} allLabel={`كل ${by === "vehicle" ? "المركبات" : "السائقين"}`} noun={by === "vehicle" ? "مركبات" : "سائقين"} />
            </div>
          </label>
        </PeriodFilter>
      </ReportHeader>
      <ReportTabs
        items={[
          { href: withParams(sp, { by: null, id: null }), label: "حسب المركبة", active: by === "vehicle" },
          { href: withParams(sp, { by: "driver", id: null }), label: "حسب السائق", active: by === "driver" },
        ]}
      />
      <p className="mb-3 text-xs text-gray-500 print:hidden">
        {by === "vehicle"
          ? "كل إيراد ومصروف على مركز تكلفة المركبة."
          : "السائق المسجل على المستند (ومنه الرواتب والعمولة من المسير)، ثم سائق الشحنة، ثم السائق المسند للمركبة في تاريخ القيد. ما لا يُعرف سائقه في سطر «دون سائق»."}
      </p>
      <RTable name={`ربحية ${by === "vehicle" ? "المركبات" : "السائقين"}`} head={head}>
        {rows.length === 0 && (
          <tr>
            <C className="py-8 text-center text-gray-500" colSpan={head.length}>
              لا توجد حركة في هذه الفترة.
            </C>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.id ?? "none"} className={r.id == null ? "bg-gray-50 text-gray-600" : ""}>
            <C className="font-medium">
              {r.id != null && ids.length !== 1 ? (
                <a href={withParams(sp, { id: String(r.id) })} className="text-brand-700 hover:underline">
                  {r.name}
                </a>
              ) : (
                r.name
              )}
            </C>
            <C num>
              <Drill href={tripsHref(r)} tip="الشحنات في الفترة">
                {r.trips || "—"}
              </Drill>
            </C>
            <C num>{r.revenue ? <Drill href={cell(r, "الإيرادات", ["4"], -1, r.revenue)}>{money(r.revenue)}</Drill> : money(r.revenue)}</C>
            {columns.map((c) => (
              <C key={c.code} num>
                {r.direct[c.code] ? <Drill href={cell(r, `${c.code} ${c.name}`, [`=${c.code}`], 1, r.direct[c.code])}>{money(r.direct[c.code])}</Drill> : "—"}
              </C>
            ))}
            <C num>
              {r.other.length ? (
                <details data-print-open>
                  <summary className="cursor-pointer text-brand-700">{money(r.otherTotal)}</summary>
                  <ul className="mt-1 space-y-0.5 text-start text-xs text-gray-600">
                    {r.other.map((o) => (
                      <li key={o.code} className="flex justify-between gap-3">
                        <span>
                          {o.account} <span className="ltr-nums text-gray-400">{o.code}</span>
                        </span>
                        <span className="ltr-nums">
                          <Drill href={cell(r, `${o.code} ${o.account}`, [`=${o.code}`], 1, o.amount)}>{money(o.amount)}</Drill>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                "—"
              )}
            </C>
            <C num>
              <Drill href={cell(r, "إجمالي التكاليف", ["5", "6", "7"], 1, r.directTotal + r.otherTotal)}>{money(r.directTotal + r.otherTotal)}</Drill>
            </C>
            <C num className={`font-semibold ${r.profit < 0 ? "text-red-600" : "text-green-700"}`}>
              <FormulaDrill formula={profitF(r, { revenue: r.revenue, direct: r.directTotal, other: r.otherTotal, profit: r.profit })}>{money(r.profit)}</FormulaDrill>
            </C>
            <C num>{r.margin != null ? <FormulaDrill formula={marginF(r, { revenue: r.revenue, direct: r.directTotal, other: r.otherTotal, profit: r.profit }, `${r.margin.toFixed(1)}%`)}>{`${r.margin.toFixed(1)}%`}</FormulaDrill> : "—"}</C>
            {by === "driver" && (
              <C className="min-w-56 text-xs text-gray-600">
                {r.routes.length > 0 && <div>{r.routes.map((x) => `${x.name} (${x.trips})`).join("، ")}</div>}
                {r.customers.length > 0 && <div className="mt-0.5 text-gray-500">{r.customers.map((x) => `${x.name} (${x.trips})`).join("، ")}</div>}
              </C>
            )}
          </tr>
        ))}
        {rows.length > 1 && (
          <tr className="bg-asphalt-900 font-bold text-white print:bg-white print:text-black">
            <C>الإجمالي</C>
            <C num>{total.trips}</C>
            <C num>
              <Drill href={cell(null, "الإيرادات", ["4"], -1, total.revenue)}>{money(total.revenue)}</Drill>
            </C>
            {columns.map((c) => (
              <C key={c.code} num>
                <Drill href={cell(null, `${c.code} ${c.name}`, [`=${c.code}`], 1, sum((r) => r.direct[c.code] ?? 0))}>{money(sum((r) => r.direct[c.code] ?? 0))}</Drill>
              </C>
            ))}
            <C num>
              <Drill href={cell(null, "مصاريف أخرى", ["6", "7"], 1, total.other)}>{money(total.other)}</Drill>
            </C>
            <C num>
              <Drill href={cell(null, "إجمالي التكاليف", ["5", "6", "7"], 1, total.direct + total.other)}>{money(total.direct + total.other)}</Drill>
            </C>
            <C num>
              <FormulaDrill formula={profitF(null, { revenue: total.revenue, direct: total.direct, other: total.other, profit: total.profit })}>{money(total.profit)}</FormulaDrill>
            </C>
            <C num>
              {total.revenue ? (
                <FormulaDrill formula={marginF(null, { revenue: total.revenue, direct: total.direct, other: total.other, profit: total.profit }, `${((total.profit / total.revenue) * 100).toFixed(1)}%`)}>{`${((total.profit / total.revenue) * 100).toFixed(1)}%`}</FormulaDrill>
              ) : (
                "—"
              )}
            </C>
            {by === "driver" && <C />}
          </tr>
        )}
      </RTable>
    </>
  );
}
