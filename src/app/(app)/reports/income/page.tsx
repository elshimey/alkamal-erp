import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { incomeStatement, previousRange } from "@/lib/reports";
import { Drill, FormulaDrill, type Formula } from "@/components/drill";
import { incomeStatementDrills } from "@/lib/drill-formulas";
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
  // «مصدر الرقم»: كل حساب ومجموع يفتح قيوده بنفس الفترة، وكل ربح يفتح معادلته (وكذلك عمود المقارنة)
  const fmt = (v: number) => money(v, false);
  const cur = incomeStatementDrills(r.sections, { from, to, period: `من ${from} إلى ${to}`, fmt, reportHref: null });
  const old = compare ? incomeStatementDrills(r.sections.map((x) => ({ ...x, current: x.previous ?? 0, lines: x.lines.map((l) => ({ ...l, current: l.previous ?? 0 })) })), { from: prev.from, to: prev.to, period: `من ${prev.from} إلى ${prev.to}`, fmt, reportHref: `/reports/income?from=${prev.from}&to=${prev.to}` }) : null;
  const change = (c: number, p: number | null) => (p == null ? "" : p === 0 ? (c === 0 ? "—" : "جديد") : `${(((c - p) / Math.abs(p)) * 100).toFixed(0)}%`);

  const subtotal = (label: string, c: number, p: number | null, strong = false, fc?: Formula, fp?: Formula) => (
    <tr key={label} className={strong ? "bg-asphalt-900 text-white print:bg-white print:text-black" : "bg-brand-50/60 font-semibold text-brand-900"}>
      <C />
      <C className={strong ? "font-bold" : ""}>{label}</C>
      <C num className={`font-bold ${c < 0 && !strong ? "text-red-600" : ""}`}>{fc ? <FormulaDrill formula={fc}>{money(c, false)}</FormulaDrill> : money(c, false)}</C>
      <C num>{pct(c)}</C>
      {compare && (
        <>
          <C num>{fp ? <FormulaDrill formula={fp}>{money(p ?? 0, false)}</FormulaDrill> : money(p ?? 0, false)}</C>
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
          <SectionRows
            key={sec.key}
            sec={sec}
            compare={compare}
            pct={pct}
            change={change}
            hrefs={{
              line: (l) => cur.line(sec, l),
              linePrev: (l) => old?.line({ ...sec, current: sec.previous ?? 0 }, { ...l, current: l.previous ?? 0 }),
              total: cur.section(sec),
              totalPrev: old?.section({ ...sec, current: sec.previous ?? 0 }),
            }}
          >
            {i === 1 && subtotal("مجمل الربح", r.current.gross, r.previous?.gross ?? null, false, cur.formulas.gross, old?.formulas.gross)}
            {i === 2 && subtotal("الربح التشغيلي", r.current.operating, r.previous?.operating ?? null, false, cur.formulas.operating, old?.formulas.operating)}
            {i === 3 && subtotal("الربح قبل الزكاة", r.current.beforeZakat, r.previous?.beforeZakat ?? null, false, cur.formulas.beforeZakat, old?.formulas.beforeZakat)}
          </SectionRows>
        ))}
        {subtotal("صافي الربح (الخسارة)", r.current.net, r.previous?.net ?? null, true, cur.formulas.net, old?.formulas.net)}
      </RTable>
    </>
  );
}

function SectionRows({
  sec,
  compare,
  pct,
  change,
  hrefs,
  children,
}: {
  hrefs: { line: (l: Line) => string; linePrev: (l: Line) => string | undefined; total: string; totalPrev?: string };
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
        <tr data-noserial>
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
          <C className="ps-8">
            <Drill href={hrefs.line(l)} tip="قيود هذا الحساب في الفترة">
              {l.name}
            </Drill>
          </C>
          <C num>
            <Drill href={hrefs.line(l)}>{money(l.current)}</Drill>
          </C>
          <C num className="text-gray-500">{pct(l.current)}</C>
          {compare && (
            <>
              <C num className="text-gray-500">
                <Drill href={hrefs.linePrev(l)}>{money(l.previous ?? 0)}</Drill>
              </C>
              <C num className="text-gray-500">{change(l.current, l.previous)}</C>
            </>
          )}
        </tr>
      ))}
      <tr className="font-semibold">
        <C />
        <C>إجمالي {sec.label}</C>
        <C num>
          <Drill href={hrefs.total}>{money(sec.current, false)}</Drill>
        </C>
        <C num>{pct(sec.current)}</C>
        {compare && (
          <>
            <C num>
              <Drill href={hrefs.totalPrev}>{money(sec.previous ?? 0, false)}</Drill>
            </C>
            <C num>{change(sec.current, sec.previous)}</C>
          </>
        )}
      </tr>
      {children}
    </>
  );
}

type Line = Awaited<ReturnType<typeof incomeStatement>>["sections"][number]["lines"][number];
