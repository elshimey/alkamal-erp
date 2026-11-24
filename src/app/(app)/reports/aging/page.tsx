import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { partyAging } from "@/lib/reports";
import { C, money, PeriodFilter, periodFrom, ReportHeader, ReportTabs, RTable, withParams, type ReportParams } from "../report-ui";
import { SIDE, sideOf } from "../party-sides";
import { Drill, FormulaDrill, type Formula } from "@/components/drill";
import { sourceHref } from "@/lib/source-lines";

const BUCKETS = [
  ["current", "غير مستحقة"],
  ["d30", "1–30 يوماً"],
  ["d60", "31–60"],
  ["d90", "61–90"],
  ["over", "أكثر من 90"],
] as const;
// أيام التأخير لكل شريحة، كما في `partyAging`
const DAYS: Record<(typeof BUCKETS)[number][0], { dmin?: number; dmax?: number }> = { current: { dmax: 0 }, d30: { dmin: 1, dmax: 30 }, d60: { dmin: 31, dmax: 60 }, d90: { dmin: 61, dmax: 90 }, over: { dmin: 91 } };

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
  // «مصدر الرقم»: الشرائح والمفتوح من الفواتير نفسها، ورصيد الدفتر من القيود، والفرق معادلة
  const supplier = side === "supplier";
  const docs = (partyId: number | undefined, name: string, label: string, b: { dmin?: number; dmax?: number }, expected: number) =>
    sourceHref({ title: `${name}: ${label}`, to, partyId, doc: "open", supplier, ...b, mode: "net", sign: 1, expected });
  const ledger = (partyId: number, name: string, expected: number) => sourceHref({ title: `${name}: رصيد الدفتر`, to, codes: [...t.codes], partyId, mode: "bal", sign: t.sign as 1 | -1, expected });
  const unlinked = (partyId: number, name: string, r: { open: number; ledger: number; unlinked: number }): Formula => ({
    title: `${name}: غير مربوط بفاتورة`,
    value: money(r.unlinked, false),
    period: `في ${to}`,
    rows: [
      { label: "رصيد الدفتر", note: "قيود حساب الجهة", value: money(r.ledger, false), href: ledger(partyId, name, r.ledger) },
      { op: "−", label: "الفواتير المفتوحة", value: money(r.open, false), href: docs(partyId || undefined, name, "الفواتير المفتوحة", {}, r.open) },
    ],
  });
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
            <C num>{r.count ? <Drill href={docs(r.id, r.name, "الفواتير المفتوحة", {}, r.open)}>{r.count}</Drill> : "—"}</C>
            {BUCKETS.map(([k, label]) => (
              <C key={k} num className={k === "over" && r.over ? "font-semibold text-red-600" : ""}>
                {r[k] ? <Drill href={docs(r.id, r.name, label, DAYS[k], r[k])}>{money(r[k])}</Drill> : money(r[k])}
              </C>
            ))}
            <C num className="font-semibold">
              {r.open ? <Drill href={docs(r.id, r.name, "الفواتير المفتوحة", {}, r.open)}>{money(r.open)}</Drill> : money(r.open)}
            </C>
            <C num>
              <Drill href={ledger(r.id, r.name, r.ledger)}>{money(r.ledger)}</Drill>
            </C>
            <C num className="text-gray-500">
              {r.unlinked ? <FormulaDrill formula={unlinked(r.id, r.name, r)}>{money(r.unlinked)}</FormulaDrill> : money(r.unlinked)}
            </C>
          </tr>
        ))}
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C>الإجمالي</C>
          <C />
          {BUCKETS.map(([k, label]) => (
            <C key={k} num>
              <Drill href={docs(undefined, `كل ${t.many}`, label, DAYS[k], sum(k))}>{money(sum(k), false)}</Drill>
            </C>
          ))}
          <C num>
            <Drill href={docs(undefined, `كل ${t.many}`, "الفواتير المفتوحة", {}, sum("open"))}>{money(sum("open"), false)}</Drill>
          </C>
          <C num>
            <Drill href={ledger(0, `كل ${t.many}`, sum("ledger"))}>{money(sum("ledger"), false)}</Drill>
          </C>
          <C num>
            <FormulaDrill formula={unlinked(0, `كل ${t.many}`, { open: sum("open"), ledger: sum("ledger"), unlinked: sum("unlinked") })}>{money(sum("unlinked"), false)}</FormulaDrill>
          </C>
        </tr>
      </RTable>
      <p className="mt-2 text-xs text-gray-500">«غير مربوط بفاتورة» = رصيد الدفتر ناقص الفواتير المفتوحة: دفعات مقدمة أو أرصدة افتتاحية أو قيود يدوية لم تُربط بفاتورة.</p>
    </>
  );
}
