import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { balanceSheet } from "@/lib/reports";
import { C, money, PeriodFilter, periodFrom, ReportHeader, RTable } from "../report-ui";

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("financial_reports", "view");
  const today = todayRiyadh();
  const { to } = periodFrom(await searchParams, today);
  const bs = await balanceSheet(db, to);
  const sides = [
    { key: "assets", label: "الأصول", total: bs.assets },
    { key: "liabilities", label: "الالتزامات", total: bs.liabilities },
    { key: "equity", label: "حقوق الملكية", total: bs.equity },
  ];

  return (
    <>
      <ReportHeader title="قائمة المركز المالي" period={`في ${to}`} filename={`المركز-المالي-${to}`}>
        <PeriodFilter from={to} to={to} today={today} asOf />
      </ReportHeader>
      <div className="mb-5 grid grid-cols-3 gap-4 print:hidden">
        {sides.map((x) => (
          <div key={x.key} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-xs text-gray-500">{x.label}</div>
            <div className="ltr-nums mt-1 text-xl font-semibold text-brand-900">{money(x.total, false)}</div>
          </div>
        ))}
      </div>
      <RTable name="قائمة المركز المالي" head={["الرمز", "البند", "المبلغ"]}>
        {sides.map((side) => (
          <SideRows key={side.key} label={side.label} total={side.total} sections={bs.sections.filter((s) => s.side === side.key)} />
        ))}
        <tr className="bg-asphalt-900 font-bold text-white print:bg-white print:text-black">
          <C />
          <C>الالتزامات وحقوق الملكية</C>
          <C num>{money(bs.liabilities + bs.equity, false)}</C>
        </tr>
      </RTable>
      <p className={`mt-3 text-sm ${bs.difference === 0 ? "text-green-700" : "text-red-600"}`}>
        {bs.difference === 0 ? "✓ القائمة متوازنة: الأصول = الالتزامات + حقوق الملكية." : `فرق ${money(bs.difference, false)}؛ راجع القيود.`}
      </p>
    </>
  );
}

function SideRows({ label, total, sections }: { label: string; total: number; sections: Awaited<ReturnType<typeof balanceSheet>>["sections"] }) {
  return (
    <>
      <tr className="bg-gray-100 font-bold text-gray-900">
        <C />
        <C>{label}</C>
        <C />
      </tr>
      {sections.map((sec) => (
        <SectionBlock key={sec.key} sec={sec} />
      ))}
      <tr className="bg-brand-50/60 font-bold text-brand-900">
        <C />
        <C>إجمالي {label}</C>
        <C num>{money(total, false)}</C>
      </tr>
    </>
  );
}

function SectionBlock({ sec }: { sec: Awaited<ReturnType<typeof balanceSheet>>["sections"][number] }) {
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
          <C className="ps-8">{l.name}</C>
          <C num>{money(l.amount, false)}</C>
        </tr>
      ))}
      <tr className="font-semibold">
        <C />
        <C className="ps-8">إجمالي {sec.label}</C>
        <C num className="border-t border-gray-300">{money(sec.total, false)}</C>
      </tr>
    </>
  );
}
