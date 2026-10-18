import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { incomeStatement, previousRange } from "@/lib/reports";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, RTable } from "../report-ui";

export default async function IncomeStatementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const compare = param(sp, "compare") !== "0";
  const prev = previousRange(from, to);
  const r = await incomeStatement(db, { from, to, compareFrom: compare ? prev.from : null, compareTo: compare ? prev.to : null });
  const revenue = r.sections[0].current;
  const pct = (v: number) => (revenue ? `${((v / revenue) * 100).toFixed(1)}%` : "—");
  const head = ["الرمز", "البند", `${from} → ${to}`, "% من الإيراد", ...(compare ? [`${prev.from} → ${prev.to}`, "التغير"] : [])];
  const change = (c: number, p: number | null) => (p == null ? "" : p === 0 ? (c === 0 ? "—" : "جديد") : `${(((c - p) / Math.abs(p)) * 100).toFixed(0)}%`);

  const subtotal = (label: string, c: number, p: number | null, strong = false) => (
    <tr key={label} className={strong ? "bg-asphalt-900 text-white print:bg-white print:text-black" : "bg-brand-50/60 font-semibold text-brand-900"}>
      <C />
      <C className={strong ? "font-bold" : ""}>{label}</C>
      <C num className={`font-bold ${c < 0 && !strong ? "text-red-600" : ""}`}>{money(c, false)}</C>
      <C num>{pct(c)}</C>
      {compare && (
        <>
          <C num>{money(p ?? 0, false)}</C>
          <C num>{change(c, p)}</C>
        </>
      )}
    </tr>
  );

  return (
    <>
      <ReportHeader title="قائمة الدخل" period={`من ${from} إلى ${to}`} filename={`قائمة-الدخل-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today}>
          <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
            <input type="checkbox" name="compare" value="1" defaultChecked={compare} className="size-4 accent-brand-600" />
            مقارنة بالفترة السابقة
          </label>
          <input type="hidden" name="compare" value="0" />
        </PeriodFilter>
      </ReportHeader>
      <RTable name="قائمة الدخل" head={head}>
        {r.sections.map((sec, i) => (
          <SectionRows key={sec.key} sec={sec} compare={compare} pct={pct} change={change}>
            {i === 1 && subtotal("مجمل الربح", r.current.gross, r.previous?.gross ?? null)}
            {i === 2 && subtotal("الربح التشغيلي", r.current.operating, r.previous?.operating ?? null)}
            {i === 3 && subtotal("الربح قبل الزكاة", r.current.beforeZakat, r.previous?.beforeZakat ?? null)}
          </SectionRows>
        ))}
        {subtotal("صافي الربح (الخسارة)", r.current.net, r.previous?.net ?? null, true)}
      </RTable>
    </>
  );
}

function SectionRows({
  sec,
  compare,
  pct,
  change,
  children,
}: {
  sec: Awaited<ReturnType<typeof incomeStatement>>["sections"][number];
  compare: boolean;
  pct: (v: number) => string;
  change: (c: number, p: number | null) => string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <tr className="bg-gray-50 font-semibold text-gray-800">
        <C className="ltr-nums text-gray-500">{sec.prefix}</C>
        <C>{sec.label}</C>
        <C />
        <C />
        {compare && (
          <>
            <C />
            <C />
          </>
        )}
      </tr>
      {sec.lines.length === 0 && (
        <tr>
          <C />
          <C className="text-gray-400">لا توجد حركة</C>
          <C num>—</C>
          <C />
          {compare && (
            <>
              <C />
              <C />
            </>
          )}
        </tr>
      )}
      {sec.lines.map((l) => (
        <tr key={l.code}>
          <C className="ltr-nums text-gray-500">{l.code}</C>
          <C className="ps-8">{l.name}</C>
          <C num>{money(l.current)}</C>
          <C num className="text-gray-500">{pct(l.current)}</C>
          {compare && (
            <>
              <C num className="text-gray-500">{money(l.previous ?? 0)}</C>
              <C num className="text-gray-500">{change(l.current, l.previous)}</C>
            </>
          )}
        </tr>
      ))}
      <tr className="font-semibold">
        <C />
        <C>إجمالي {sec.label}</C>
        <C num>{money(sec.current, false)}</C>
        <C num>{pct(sec.current)}</C>
        {compare && (
          <>
            <C num>{money(sec.previous ?? 0, false)}</C>
            <C num>{change(sec.current, sec.previous)}</C>
          </>
        )}
      </tr>
      {children}
    </>
  );
}
