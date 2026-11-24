import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { partyBalances } from "@/lib/reports";
import { C, money, PeriodFilter, periodFrom, ReportHeader, ReportTabs, RTable, withParams, type ReportParams } from "../report-ui";
import { SIDE, sideOf } from "../party-sides";
import { Drill } from "@/components/drill";
import { sourceHref } from "@/lib/source-lines";

/** أرصدة العملاء أو الموردين في الفترة (مبيعات / مشتريات في مركز التقارير). */
export default async function PartyBalancesPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const side = sideOf(sp);
  const t = SIDE[side];
  const rows = await partyBalances(db, { side, from, to });
  const sum = (k: "opening" | "debit" | "credit" | "closing") => rows.reduce((a, r) => a + r[k], 0);
  // «مصدر الرقم»: قيود حساب الجهة (0 = كل الجهات) بنفس الفترة
  const dayBefore = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const k = t.sign as 1 | -1;
  const h = (partyId: number, name: string, col: "opening" | "debit" | "credit" | "closing", expected: number) =>
    col === "debit" || col === "credit"
      ? sourceHref({ title: `${name}: ${col === "debit" ? "مدين" : "دائن"}`, from, to, codes: [...t.codes], partyId, side: col === "debit" ? "d" : "c", mode: "net", sign: col === "debit" ? 1 : -1, expected })
      : sourceHref({ title: `${name}: ${col === "opening" ? "الرصيد الافتتاحي" : t.balance}`, to: col === "opening" ? dayBefore : to, codes: [...t.codes], partyId, mode: "bal", sign: k, expected });
  return (
    <>
      <ReportHeader title={`أرصدة ${t.many}`} period={`من ${from} إلى ${to}`} filename={`أرصدة-${t.many}-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today}>
          <input type="hidden" name="side" value={side} />
        </PeriodFilter>
      </ReportHeader>
      <ReportTabs
        items={[
          { href: withParams(sp, { side: null }), label: "العملاء", active: side === "customer" },
          { href: withParams(sp, { side: "supplier" }), label: "الموردون", active: side === "supplier" },
        ]}
      />
      <RTable name={`أرصدة ${t.many}`} head={[t.one, "الرصيد الافتتاحي", "مدين", "دائن", t.balance]}>
        {rows.length === 0 && (
          <tr>
            <C colSpan={5} className="py-8 text-center text-gray-500">
              لا أرصدة في هذه الفترة
            </C>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.id}>
            <C>
              <a href={`/reports/party-statement${withParams(sp, { party: String(r.id) })}`} className="text-brand-700 hover:underline">
                {r.name}
              </a>
            </C>
            <C num>
              <Drill href={h(r.id, r.name, "opening", r.opening)}>{money(r.opening)}</Drill>
            </C>
            <C num>
              <Drill href={h(r.id, r.name, "debit", r.debit)}>{money(r.debit)}</Drill>
            </C>
            <C num>
              <Drill href={h(r.id, r.name, "credit", r.credit)}>{money(r.credit)}</Drill>
            </C>
            <C num className={`font-semibold ${r.closing < 0 ? "text-red-600" : ""}`}>
              <Drill href={h(r.id, r.name, "closing", r.closing)}>{money(r.closing)}</Drill>
            </C>
          </tr>
        ))}
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C>الإجمالي</C>
          <C num>
            <Drill href={h(0, `كل ${t.many}`, "opening", sum("opening"))}>{money(sum("opening"), false)}</Drill>
          </C>
          <C num>
            <Drill href={h(0, `كل ${t.many}`, "debit", sum("debit"))}>{money(sum("debit"), false)}</Drill>
          </C>
          <C num>
            <Drill href={h(0, `كل ${t.many}`, "credit", sum("credit"))}>{money(sum("credit"), false)}</Drill>
          </C>
          <C num>
            <Drill href={h(0, `كل ${t.many}`, "closing", sum("closing"))}>{money(sum("closing"), false)}</Drill>
          </C>
        </tr>
      </RTable>
      <p className="mt-2 text-xs text-gray-500">
        {side === "customer" ? "من حساب العملاء 1103." : "من حسابات الموردين والناقلين والمحطات والورش والمخلصين 2101–2105."} السالب (بين قوسين) رصيد عكسي (دفعة زائدة). اضغط الاسم لكشف حسابه.
      </p>
    </>
  );
}
