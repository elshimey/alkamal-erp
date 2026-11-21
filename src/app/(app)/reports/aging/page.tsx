import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { partyAging } from "@/lib/reports";
import { C, money, PeriodFilter, periodFrom, ReportHeader, ReportTabs, RTable, withParams, type ReportParams } from "../report-ui";
import { SIDE, sideOf } from "../party-sides";

const BUCKETS = [
  ["current", "غير مستحقة"],
  ["d30", "1–30 يوماً"],
  ["d60", "31–60"],
  ["d90", "61–90"],
  ["over", "أكثر من 90"],
] as const;

/** أعمار الديون المدينة (العملاء) أو الدائنة (الموردين) في تاريخ، مع مطابقة رصيد الدفتر. */
export default async function AgingPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { to } = periodFrom(sp, today);
  const side = sideOf(sp);
  const t = SIDE[side];
  const rows = await partyAging(db, { side, asOf: to });
  const sum = (k: (typeof BUCKETS)[number][0] | "open" | "ledger" | "unlinked") => rows.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <ReportHeader title={`أعمار ${t.debts}`} period={`في ${to}`} filename={`أعمار-${t.debts}-${to}`} wide note="بالريال السعودي، الفواتير المفتوحة حسب أيام التأخير عن الاستحقاق">
        <PeriodFilter from={to} to={to} today={today} asOf>
          <input type="hidden" name="side" value={side} />
        </PeriodFilter>
      </ReportHeader>
      <ReportTabs
        items={[
          { href: withParams(sp, { side: null }), label: "الديون المدينة (العملاء)", active: side === "customer" },
          { href: withParams(sp, { side: "supplier" }), label: "الديون الدائنة (الموردون)", active: side === "supplier" },
        ]}
      />
      <RTable name={`أعمار ${t.debts}`} head={[t.one, "فواتير مفتوحة", ...BUCKETS.map((b) => b[1]), "المفتوح", "رصيد الدفتر", "غير مربوط بفاتورة"]}>
        {rows.length === 0 && (
          <tr>
            <C colSpan={10} className="py-8 text-center text-gray-500">
              لا أرصدة مفتوحة
            </C>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.id}>
            <C>
              <a href={`/reports/party-statement${withParams({ side: side === "supplier" ? "supplier" : undefined, party: String(r.id), to }, {})}`} className="text-brand-700 hover:underline">
                {r.name}
              </a>
            </C>
            <C num>{r.count || "—"}</C>
            {BUCKETS.map(([k]) => (
              <C key={k} num className={k === "over" && r.over ? "font-semibold text-red-600" : ""}>
                {money(r[k])}
              </C>
            ))}
            <C num className="font-semibold">
              {money(r.open)}
            </C>
            <C num>{money(r.ledger)}</C>
            <C num className="text-gray-500">
              {money(r.unlinked)}
            </C>
          </tr>
        ))}
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C>الإجمالي</C>
          <C />
          {BUCKETS.map(([k]) => (
            <C key={k} num>
              {money(sum(k), false)}
            </C>
          ))}
          <C num>{money(sum("open"), false)}</C>
          <C num>{money(sum("ledger"), false)}</C>
          <C num>{money(sum("unlinked"), false)}</C>
        </tr>
      </RTable>
      <p className="mt-2 text-xs text-gray-500">«غير مربوط بفاتورة» = رصيد الدفتر ناقص الفواتير المفتوحة: دفعات مقدمة أو أرصدة افتتاحية أو قيود يدوية لم تُربط بفاتورة.</p>
    </>
  );
}
