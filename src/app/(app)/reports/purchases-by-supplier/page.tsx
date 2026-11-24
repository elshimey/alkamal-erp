import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { purchasesBySupplier } from "@/lib/reports";
import { Drill, FormulaDrill, type Formula } from "@/components/drill";
import { periodSource } from "@/lib/drill-formulas";
import { C, money, PeriodFilter, periodFrom, ReportHeader, RTable, type ReportParams } from "../report-ui";

/** المشتريات حسب المورد: ما قُيد على ذمة كل مورد (فواتير، صيانة آجلة، مصروفات مستحقة) دون السداد، وضريبتها. */
export default async function PurchasesBySupplierPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const rows = await purchasesBySupplier(db, from, to);
  const sum = (k: "bills" | "net" | "vat" | "total") => rows.reduce((a, r) => a + r[k], 0);
  // «مصدر الرقم»: قيود ذمم المورد 2101–2105 وضريبتها 1108 دون سندات الصرف (0 = كل الموردين)
  const src = periodSource(from, to);
  const PAY = ["=2101", "=2102", "=2103", "=2104", "=2105"];
  const gross = (id: number, name: string, expected: number) => src({ title: `${name}: الإجمالي`, codes: PAY, partyId: id, excludeSourceTypes: ["payment"], sign: -1, expected });
  const vat = (id: number, name: string, expected: number) => src({ title: `${name}: الضريبة`, codes: ["=1108"], partyId: id, excludeSourceTypes: ["payment"], sign: 1, expected });
  const bills = (id: number, name: string) => src({ title: `فواتير ${name}`, codes: PAY, partyId: id, sourceTypes: ["purchase_invoice"] });
  const netF = (id: number, name: string, r: { net: number; vat: number; total: number }): Formula => ({
    title: `${name}: قبل الضريبة`,
    value: money(r.net, false),
    period: `من ${from} إلى ${to}`,
    rows: [
      { label: "الإجمالي", note: "ذمم المورد 2101–2105", value: money(r.total, false), href: gross(id, name, r.total) },
      { op: "−", label: "الضريبة", note: "حساب 1108", value: money(r.vat, false), href: vat(id, name, r.vat) },
    ],
  });
  return (
    <>
      <ReportHeader title="المشتريات حسب المورد" period={`من ${from} إلى ${to}`} filename={`المشتريات-حسب-المورد-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today} />
      </ReportHeader>
      <RTable name="المشتريات حسب المورد" head={["المورد", "فواتير الموردين", "قبل الضريبة", "الضريبة", "الإجمالي"]}>
        {rows.length === 0 && (
          <tr>
            <C colSpan={5} className="py-8 text-center text-gray-500">
              لا مشتريات في هذه الفترة
            </C>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.id}>
            <C>
              <a href={`/reports/party-statement?side=supplier&party=${r.id}&from=${from}&to=${to}`} className="text-brand-700 hover:underline">
                {r.name}
              </a>
            </C>
            <C num>{r.bills ? <Drill href={bills(r.id, r.name)}>{r.bills}</Drill> : "—"}</C>
            <C num>
              <FormulaDrill formula={netF(r.id, r.name, r)}>{money(r.net)}</FormulaDrill>
            </C>
            <C num>{r.vat ? <Drill href={vat(r.id, r.name, r.vat)}>{money(r.vat)}</Drill> : "—"}</C>
            <C num className="font-semibold">
              <Drill href={gross(r.id, r.name, r.total)}>{money(r.total)}</Drill>
            </C>
          </tr>
        ))}
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C>الإجمالي</C>
          <C num>
            <Drill href={bills(0, "كل الموردين")}>{sum("bills")}</Drill>
          </C>
          <C num>
            <FormulaDrill formula={netF(0, "كل الموردين", { net: sum("net"), vat: sum("vat"), total: sum("total") })}>{money(sum("net"), false)}</FormulaDrill>
          </C>
          <C num>
            <Drill href={vat(0, "كل الموردين", sum("vat"))}>{money(sum("vat"), false)}</Drill>
          </C>
          <C num>
            <Drill href={gross(0, "كل الموردين", sum("total"))}>{money(sum("total"), false)}</Drill>
          </C>
        </tr>
      </RTable>
      <p className="mt-2 text-xs text-gray-500">من ذمم الموردين 2101–2105 دون سندات الصرف، والضريبة من 1108 على سطور المورد. المشتريات النقدية دون مورد لا تظهر هنا (انظر المصروفات).</p>
    </>
  );
}
