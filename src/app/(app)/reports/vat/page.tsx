import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { presetRanges, vatReturn } from "@/lib/reports";
import { Drill, FormulaDrill, type Formula } from "@/components/drill";
import { sourceHref } from "@/lib/source-lines";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, RTable } from "../report-ui";

export default async function VatReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  // الإقرار ربع سنوي، فالافتراضي هو الربع الحالي.
  const quarter = presetRanges(today).find((p) => p.key === "quarter")!;
  const { from, to } = param(sp, "from") ? periodFrom(sp, today) : quarter;
  const v = await vatReturn(db, from, to);
  const due = v.net >= 0;
  // «مصدر الرقم»: خانات المبيعات من الفواتير والإشعارات نفسها، والضريبة من حسابيها، والصافي معادلة
  const per = `من ${from} إلى ${to}`;
  const sale = (b: (typeof v.sales)[number], dir: "in" | "out" | undefined, label: string, expected?: number) =>
    sourceHref({ title: `${b.label}: ${label}`, from, to, doc: "vat_sales", tax: b.behavior, dir, mode: "net", sign: 1, expected });
  const outputHref = sourceHref({ title: "ضريبة المخرجات", from, to, codes: ["2109"], mode: "net", sign: -1, expected: v.output });
  const inputHref = sourceHref({ title: "ضريبة المدخلات", from, to, codes: ["1108"], mode: "net", sign: 1, expected: v.input });
  const purVat = (b: (typeof v.purchases)[number]) => sourceHref({ title: `${b.label}: الضريبة`, from, to, codes: ["1108"], tax: b.behavior, mode: "net", sign: 1, expected: b.vat });
  const purAmount = (b: (typeof v.purchases)[number]): { href?: string; formula?: Formula } =>
    b.vat
      ? { formula: { title: `${b.label}: المبلغ`, value: money(b.amount, false), period: per, rows: [{ label: "ضريبة المدخلات لهذا النوع", note: "حساب 1108", value: money(b.vat, false), href: purVat(b) }, { op: "÷", label: "النسبة الأساسية", value: "15%" }] } }
      : { href: sourceHref({ title: `${b.label}: المبلغ`, from, to, doc: "vat_pzero", tax: b.behavior, mode: "net", sign: 1, expected: b.amount }) };
  const salesTotal: Formula = {
    title: "إجمالي المبيعات",
    value: money(v.sales.reduce((a, b) => a + b.amount + b.adjust, 0), false),
    period: per,
    rows: v.sales.filter((b) => b.amount || b.adjust).map((b, i) => ({ op: i ? "+" : "", label: b.label, note: "المبلغ مع التعديلات", value: money(b.amount + b.adjust, false), href: sale(b, undefined, "المبلغ مع التعديلات", b.amount + b.adjust) })),
  };
  const purTotal: Formula = {
    title: "إجمالي المشتريات",
    value: money(v.purchases.reduce((a, b) => a + b.amount, 0), false),
    period: per,
    rows: v.purchases.filter((b) => b.amount).map((b, i) => ({ op: i ? "+" : "", label: b.label, value: money(b.amount, false), formula: purAmount(b).formula, href: purAmount(b).href })),
  };
  const netF: Formula = {
    title: due ? "صافي الضريبة المستحقة" : "صافي الضريبة القابلة للاسترداد",
    value: money(Math.abs(v.net), false),
    period: per,
    rows: [
      { label: "ضريبة المخرجات", note: "حساب 2109", value: money(v.output, false), href: outputHref },
      { op: "−", label: "ضريبة المدخلات", note: "حساب 1108", value: money(v.input, false), href: inputHref },
    ],
    allHref: sourceHref({ title: "صافي الضريبة", from, to, codes: ["2109", "1108"], mode: "net", sign: -1, expected: v.net }),
  };

  return (
    <>
      <ReportHeader title="إقرار ضريبة القيمة المضافة" period={`من ${from} إلى ${to}`} filename={`إقرار-الضريبة-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today} />
      </ReportHeader>
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3 print:hidden">
        <Drill href={outputHref} card className="block rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">ضريبة المخرجات (المبيعات)</div>
          <div className="ltr-nums mt-1 text-xl font-semibold">{money(v.output, false)}</div>
        </Drill>
        <Drill href={inputHref} card className="block rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">ضريبة المدخلات (المشتريات)</div>
          <div className="ltr-nums mt-1 text-xl font-semibold">{money(v.input, false)}</div>
        </Drill>
        <FormulaDrill formula={netF} card className={`block rounded-2xl p-4 shadow-sm ${due ? "bg-asphalt-900 text-white" : "bg-green-700 text-white"}`}>
          <div className="text-xs text-white/70">{due ? "صافي الضريبة المستحقة للسداد" : "صافي الضريبة القابلة للاسترداد"}</div>
          <div className="ltr-nums mt-1 text-xl font-semibold">{money(Math.abs(v.net), false)}</div>
        </FormulaDrill>
      </div>
      <RTable name="إقرار ضريبة القيمة المضافة" serial={false} head={["الخانة", "البند", "المبلغ (ريال)", "التعديلات", "ضريبة القيمة المضافة"]}>
        <tr className="bg-gray-100 font-bold">
          <C />
          <C>المبيعات</C>
          <C />
          <C />
          <C />
        </tr>
        {v.sales.map((b, i) => (
          <tr key={b.behavior}>
            <C className="ltr-nums text-gray-500">{i + 1}</C>
            <C>{b.label}</C>
            <C num>{b.amount ? <Drill href={sale(b, "in", "الفواتير", b.amount)}>{money(b.amount)}</Drill> : money(b.amount)}</C>
            <C num>{b.adjust ? <Drill href={sale(b, "out", "الإشعارات", b.adjust)}>{money(b.adjust)}</Drill> : "—"}</C>
            <C num>{b.vat ? <Drill href={sale(b, undefined, "الفواتير والإشعارات")}>{money(b.vat)}</Drill> : "—"}</C>
          </tr>
        ))}
        <tr className="font-semibold">
          <C />
          <C>إجمالي المبيعات وضريبة المخرجات</C>
          <C num>
            <FormulaDrill formula={salesTotal}>{money(v.sales.reduce((a, b) => a + b.amount + b.adjust, 0), false)}</FormulaDrill>
          </C>
          <C />
          <C num>
            <Drill href={outputHref}>{money(v.output, false)}</Drill>
          </C>
        </tr>
        <tr className="bg-gray-100 font-bold">
          <C />
          <C>المشتريات</C>
          <C />
          <C />
          <C />
        </tr>
        {v.purchases.map((b, i) => (
          <tr key={b.behavior}>
            <C className="ltr-nums text-gray-500">{v.sales.length + i + 1}</C>
            <C>{b.label}</C>
            <C num>{b.amount ? (purAmount(b).formula ? <FormulaDrill formula={purAmount(b).formula!}>{money(b.amount)}</FormulaDrill> : <Drill href={purAmount(b).href}>{money(b.amount)}</Drill>) : money(b.amount)}</C>
            <C num>—</C>
            <C num>{b.vat ? <Drill href={purVat(b)}>{money(b.vat)}</Drill> : "—"}</C>
          </tr>
        ))}
        <tr className="font-semibold">
          <C />
          <C>إجمالي ضريبة المدخلات</C>
          <C num>
            <FormulaDrill formula={purTotal}>{money(v.purchases.reduce((a, b) => a + b.amount, 0), false)}</FormulaDrill>
          </C>
          <C />
          <C num>
            <Drill href={inputHref}>{money(v.input, false)}</Drill>
          </C>
        </tr>
        <tr className="bg-asphalt-900 font-bold text-white print:bg-white print:text-black">
          <C />
          <C>{due ? "صافي الضريبة المستحقة" : "صافي الضريبة القابلة للاسترداد"}</C>
          <C />
          <C />
          <C num>
            <FormulaDrill formula={netF}>{money(Math.abs(v.net), false)}</FormulaDrill>
          </C>
        </tr>
      </RTable>
      <p className="mt-2 text-xs text-gray-500">
        ضريبة المخرجات من حساب ضريبة المخرجات (2109) وضريبة المدخلات من حساب ضريبة المدخلات (1108) بعد القيود المرحّلة فقط. وعاء المشتريات الخاضعة محسوب من ضريبتها بنسبة 15%، والاحتساب العكسي يظهر في المخرجات والمدخلات معاً. كل نوع ضريبة في خانته حسب «يتصرف مثل».
      </p>
    </>
  );
}
