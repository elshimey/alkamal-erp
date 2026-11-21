import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { driverOptions, vehicleOptions } from "@/lib/lookups";
import { fleetProfitability, type FleetBy } from "@/lib/reports";
import { FormCombo } from "@/components/form-combo";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, ReportTabs, RTable, withParams, type ReportParams } from "../report-ui";

/**
 * ربحية المركبات والسائقين (الخطوة 5): عمود لكل حساب تكلفة مباشرة فيه أرقام، و«مصاريف أخرى» تتفتح تفاصيلها،
 * وعدد الرحلات، وعرض السائق يضيف مساراته وعملاءه. فلتر لمركبة واحدة أو سائق واحد.
 */
export default async function FleetProfitPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const by: FleetBy = param(sp, "by") === "driver" ? "driver" : "vehicle";
  const id = Number(param(sp, "id")) || null;
  const [options, { columns, rows }] = await Promise.all([by === "vehicle" ? vehicleOptions() : driverOptions(), fleetProfitability(db, { from, to, by, id })]);
  const one = by === "vehicle" ? "المركبة" : "السائق";
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const total = { trips: sum((r) => r.trips), revenue: sum((r) => r.revenue), direct: sum((r) => r.directTotal), other: sum((r) => r.otherTotal), profit: sum((r) => r.profit) };
  const selected = id ? options.find((o) => o.value === String(id))?.label : null;
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
            <span className="font-medium text-gray-700">{one} (اختياري)</span>
            <div className="w-64 max-w-full">
              <FormCombo name="id" options={options} defaultValue={id ? String(id) : ""} placeholder={`كل ${by === "vehicle" ? "المركبات" : "السائقين"}`} />
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
              {r.id != null && !id ? (
                <a href={withParams(sp, { id: String(r.id) })} className="text-brand-700 hover:underline">
                  {r.name}
                </a>
              ) : (
                r.name
              )}
            </C>
            <C num>{r.trips || "—"}</C>
            <C num>{money(r.revenue)}</C>
            {columns.map((c) => (
              <C key={c.code} num>
                {money(r.direct[c.code] ?? 0)}
              </C>
            ))}
            <C num>
              {r.other.length ? (
                <details>
                  <summary className="cursor-pointer text-brand-700">{money(r.otherTotal)}</summary>
                  <ul className="mt-1 space-y-0.5 text-start text-xs text-gray-600">
                    {r.other.map((o) => (
                      <li key={o.code} className="flex justify-between gap-3">
                        <span>
                          {o.account} <span className="ltr-nums text-gray-400">{o.code}</span>
                        </span>
                        <span className="ltr-nums">{money(o.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                "—"
              )}
            </C>
            <C num>{money(r.directTotal + r.otherTotal)}</C>
            <C num className={`font-semibold ${r.profit < 0 ? "text-red-600" : "text-green-700"}`}>{money(r.profit)}</C>
            <C num>{r.margin != null ? `${r.margin.toFixed(1)}%` : "—"}</C>
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
            <C num>{money(total.revenue)}</C>
            {columns.map((c) => (
              <C key={c.code} num>
                {money(sum((r) => r.direct[c.code] ?? 0))}
              </C>
            ))}
            <C num>{money(total.other)}</C>
            <C num>{money(total.direct + total.other)}</C>
            <C num>{money(total.profit)}</C>
            <C num>{total.revenue ? `${((total.profit / total.revenue) * 100).toFixed(1)}%` : "—"}</C>
            {by === "driver" && <C />}
          </tr>
        )}
      </RTable>
    </>
  );
}
