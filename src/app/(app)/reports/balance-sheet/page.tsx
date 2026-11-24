import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { balanceSheet } from "@/lib/reports";
import { Drill, FormulaDrill, type Formula } from "@/components/drill";
import { sourceHref } from "@/lib/source-lines";
import { C, money, PeriodFilter, periodFrom, ReportHeader, RTable } from "../report-ui";

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("financial_reports", "view");
  const today = todayRiyadh();
  const { to } = periodFrom(await searchParams, today);
  const bs = await balanceSheet(db, to);
  // «مصدر الرقم»: الرصيد في التاريخ = افتتاحي + حركة حتى آخره (الأصول مدينة، والالتزامات وحقوق الملكية دائنة)
  const yearStart = `${to.slice(0, 4)}-01-01`;
  const dayBefore = new Date(Date.parse(yearStart) - 86400000).toISOString().slice(0, 10);
  const bal = (title: string, codes: string[], sign: 1 | -1, expected: number) => sourceHref({ title, to, codes, mode: "bal", sign, expected });
  const prefixes = (side: string) => bs.sections.filter((x) => x.side === side).map((x) => x.prefix as string);
  const equityCodes = ["3", "4", "5", "6", "7"];
  const sides = [
    { key: "assets", label: "الأصول", total: bs.assets, href: bal("الأصول", prefixes("assets"), 1, bs.assets) },
    { key: "liabilities", label: "الالتزامات", total: bs.liabilities, href: bal("الالتزامات", prefixes("liabilities"), -1, bs.liabilities) },
    { key: "equity", label: "حقوق الملكية", total: bs.equity, href: bal("حقوق الملكية مع أرباح الفترات", equityCodes, -1, bs.equity) },
  ];
  const lineHref = (sec: Section, l: Section["lines"][number]) => {
    const sign = sec.side === "assets" ? 1 : -1;
    if (l.code) return bal(`${l.code} ${l.name}`, [l.code], sign, l.amount);
    if (l.name.startsWith("صافي ربح")) return sourceHref({ title: l.name, from: yearStart, to, codes: ["4", "5", "6", "7"], mode: "net", sign: -1, expected: l.amount });
    return sourceHref({ title: l.name, to: dayBefore, codes: ["4", "5", "6", "7"], mode: "bal", sign: -1, expected: l.amount });
  };
  const secHref = (sec: Section) => bal(sec.label, sec.key === "equity" ? equityCodes : [sec.prefix], sec.side === "assets" ? 1 : -1, sec.total);
  const both: Formula = {
    title: "الالتزامات وحقوق الملكية",
    value: money(bs.liabilities + bs.equity, false),
    period: `في ${to}`,
    rows: [
      { label: "الالتزامات", value: money(bs.liabilities, false), href: sides[1].href },
      { op: "+", label: "حقوق الملكية", note: "ومنها ربح السنة الجارية والسابقة غير المقفلة", value: money(bs.equity, false), href: sides[2].href },
    ],
  };

  return (
    <>
      <ReportHeader title="قائمة المركز المالي" period={`في ${to}`} filename={`المركز-المالي-${to}`}>
        <PeriodFilter from={to} to={to} today={today} asOf />
      </ReportHeader>
      <div className="mb-5 grid grid-cols-3 gap-4 print:hidden">
        {sides.map((x) => (
          <Drill key={x.key} href={x.href} card className="block rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-xs text-gray-500">{x.label}</div>
            <div className="ltr-nums mt-1 text-xl font-semibold text-brand-900">{money(x.total, false)}</div>
          </Drill>
        ))}
      </div>
      <RTable name="قائمة المركز المالي" head={["الرمز", "البند", "المبلغ"]}>
        {sides.map((side) => (
          <SideRows key={side.key} label={side.label} total={side.total} href={side.href} sections={bs.sections.filter((s) => s.side === side.key)} lineHref={lineHref} secHref={secHref} />
        ))}
        <tr className="bg-asphalt-900 font-bold text-white print:bg-white print:text-black">
          <C />
          <C>الالتزامات وحقوق الملكية</C>
          <C num>
            <FormulaDrill formula={both}>{money(bs.liabilities + bs.equity, false)}</FormulaDrill>
          </C>
        </tr>
      </RTable>
      <p className={`mt-3 text-sm ${bs.difference === 0 ? "text-green-700" : "text-red-600"}`}>
        {bs.difference === 0 ? "✓ القائمة متوازنة: الأصول = الالتزامات + حقوق الملكية." : `فرق ${money(bs.difference, false)}؛ راجع القيود.`}
      </p>
    </>
  );
}

type Section = Awaited<ReturnType<typeof balanceSheet>>["sections"][number];
type Hrefs = { lineHref: (sec: Section, l: Section["lines"][number]) => string; secHref: (sec: Section) => string };

function SideRows({ label, total, href, sections, lineHref, secHref }: { label: string; total: number; href: string; sections: Section[] } & Hrefs) {
  return (
    <>
      <tr className="bg-gray-100 font-bold text-gray-900">
        <C />
        <C>{label}</C>
        <C />
      </tr>
      {sections.map((sec) => (
        <SectionBlock key={sec.key} sec={sec} lineHref={lineHref} secHref={secHref} />
      ))}
      <tr className="bg-brand-50/60 font-bold text-brand-900">
        <C />
        <C>إجمالي {label}</C>
        <C num>
          <Drill href={href}>{money(total, false)}</Drill>
        </C>
      </tr>
    </>
  );
}

function SectionBlock({ sec, lineHref, secHref }: { sec: Section } & Hrefs) {
  return (
    <>
      <tr className="font-semibold text-gray-700">
        <C className="ltr-nums text-gray-500">{sec.prefix}</C>
        <C>{sec.label}</C>
        <C />
      </tr>
      {sec.lines.map((l, i) => (
        <tr key={`${l.code}-${i}`}>
          <C className="ltr-nums text-gray-500">{l.code}</C>
          <C className="ps-8">
            <Drill href={lineHref(sec, l)} tip="قيود هذا الحساب حتى التاريخ">
              {l.name}
            </Drill>
          </C>
          <C num>
            <Drill href={lineHref(sec, l)}>{money(l.amount, false)}</Drill>
          </C>
        </tr>
      ))}
      <tr className="font-semibold">
        <C />
        <C className="ps-8">إجمالي {sec.label}</C>
        <C num className="border-t border-gray-300">
          <Drill href={secHref(sec)}>{money(sec.total, false)}</Drill>
        </C>
      </tr>
    </>
  );
}
