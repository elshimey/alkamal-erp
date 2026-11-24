import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { salesByCustomer } from "@/lib/reports";
import { Drill, FormulaDrill, type Formula } from "@/components/drill";
import { periodSource } from "@/lib/drill-formulas";
import { C, money, PeriodFilter, periodFrom, ReportHeader, RTable, type ReportParams } from "../report-ui";

/** المبيعات حسب العميل: الإيراد والمصاريف المستردة والضريبة من قيود الفوترة والإشعارات. */
export default async function SalesByCustomerPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const rows = await salesByCustomer(db, from, to);
  const sum = (k: "invoices" | "revenue" | "recharged" | "vat" | "total") => rows.reduce((a, r) => a + r[k], 0);
  const total = sum("total");
  // «مصدر الرقم»: قيود الفوترة والإشعارات التي تمس حساب العملاء 1103 لهذا العميل (0 = كل العملاء)
  const src = periodSource(from, to);
  const base = { touch: ["=1103"] };
  const h = (id: number, name: string, label: string, codes: string[], expected: number) => src({ title: `${name}: ${label}`, codes, partyId: id, sign: -1, expected, ...base });
  const invoicesHref = (id: number, name: string) => src({ title: `فواتير ${name}`, codes: ["=1103"], partyId: id, sourceTypes: ["sales_invoice"] });
  const totalF = (id: number, name: string, r: { revenue: number; recharged: number; vat: number; total: number }): Formula => ({
    title: `مبيعات ${name}`,
    value: money(r.total, false),
    period: `من ${from} إلى ${to}`,
    rows: [
      { label: "الإيراد", note: "حسابات 4", value: money(r.revenue, false), href: h(id, name, "الإيراد", ["4"], r.revenue) },
      { op: "+", label: "مصاريف مستردة", note: "حساب 1114", value: money(r.recharged, false), href: h(id, name, "مصاريف مستردة", ["=1114"], r.recharged) },
      { op: "+", label: "الضريبة", note: "حساب 2109", value: money(r.vat, false), href: h(id, name, "الضريبة", ["=2109"], r.vat) },
    ],
    allHref: h(id, name, "الإجمالي", ["4", "=1114", "=2109"], r.total),
  });
  const shareF = (id: number, name: string, r: { revenue: number; recharged: number; vat: number; total: number }, pct: string): Formula => ({
    title: `نسبة ${name}`,
    value: pct,
    period: `من ${from} إلى ${to}`,
    rows: [
      { label: `مبيعات ${name}`, value: money(r.total, false), formula: totalF(id, name, r) },
      { op: "÷", label: "مبيعات كل العملاء", value: money(total, false), formula: totalF(0, "كل العملاء", { revenue: sum("revenue"), recharged: sum("recharged"), vat: sum("vat"), total }) },
    ],
  });
  return (
    <>
      <ReportHeader title="المبيعات حسب العميل" period={`من ${from} إلى ${to}`} filename={`المبيعات-حسب-العميل-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today} />
      </ReportHeader>
      <RTable name="المبيعات حسب العميل" head={["العميل", "الفواتير", "الإيراد", "مصاريف مستردة", "الضريبة", "الإجمالي", "النسبة"]}>
        {rows.length === 0 && (
          <tr>
            <C colSpan={7} className="py-8 text-center text-gray-500">
              لا مبيعات في هذه الفترة
            </C>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.id}>
            <C>
              <a href={`/reports/party-statement?party=${r.id}&from=${from}&to=${to}`} className="text-brand-700 hover:underline">
                {r.name}
              </a>
            </C>
            <C num>{r.invoices ? <Drill href={invoicesHref(r.id, r.name)}>{r.invoices}</Drill> : "—"}</C>
            <C num>{r.revenue ? <Drill href={h(r.id, r.name, "الإيراد", ["4"], r.revenue)}>{money(r.revenue)}</Drill> : "—"}</C>
            <C num>{r.recharged ? <Drill href={h(r.id, r.name, "مصاريف مستردة", ["=1114"], r.recharged)}>{money(r.recharged)}</Drill> : "—"}</C>
            <C num>{r.vat ? <Drill href={h(r.id, r.name, "الضريبة", ["=2109"], r.vat)}>{money(r.vat)}</Drill> : "—"}</C>
            <C num className="font-semibold">
              <FormulaDrill formula={totalF(r.id, r.name, r)}>{money(r.total)}</FormulaDrill>
            </C>
            <C num className="text-gray-500">
              {total ? <FormulaDrill formula={shareF(r.id, r.name, r, `${((r.total / total) * 100).toFixed(1)}%`)}>{`${((r.total / total) * 100).toFixed(1)}%`}</FormulaDrill> : "—"}
            </C>
          </tr>
        ))}
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C>الإجمالي</C>
          <C num>
            <Drill href={invoicesHref(0, "كل العملاء")}>{sum("invoices")}</Drill>
          </C>
          <C num>
            <Drill href={h(0, "كل العملاء", "الإيراد", ["4"], sum("revenue"))}>{money(sum("revenue"), false)}</Drill>
          </C>
          <C num>
            <Drill href={h(0, "كل العملاء", "مصاريف مستردة", ["=1114"], sum("recharged"))}>{money(sum("recharged"), false)}</Drill>
          </C>
          <C num>
            <Drill href={h(0, "كل العملاء", "الضريبة", ["=2109"], sum("vat"))}>{money(sum("vat"), false)}</Drill>
          </C>
          <C num>
            <FormulaDrill formula={totalF(0, "كل العملاء", { revenue: sum("revenue"), recharged: sum("recharged"), vat: sum("vat"), total })}>{money(total, false)}</FormulaDrill>
          </C>
          <C />
        </tr>
      </RTable>
      <p className="mt-2 text-xs text-gray-500">الإيراد من حسابات 4xxx بعد الإشعارات الدائنة والمدينة، والمصاريف المستردة ما فُوتر من 1114، والضريبة من 2109.</p>
    </>
  );
}
