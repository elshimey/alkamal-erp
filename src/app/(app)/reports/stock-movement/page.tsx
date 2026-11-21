import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { stockMovement } from "@/lib/reports";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, RTable, type ReportParams } from "../report-ui";

const qty = (v: number) => (Math.abs(v) < 0.0005 ? "—" : v.toLocaleString("en", { maximumFractionDigits: 3 }));

/** حركة المخزون: الافتتاحي والوارد والصادر والختامي لكل صنف كمية وقيمة. */
export default async function StockMovementPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("inventory", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const warehouseId = Number(param(sp, "wh")) || null;
  const [rows, warehouses] = await Promise.all([stockMovement(db, { from, to, warehouseId }), db.select({ id: s.warehouses.id, name: s.warehouses.nameAr }).from(s.warehouses).orderBy(asc(s.warehouses.nameAr))]);
  const sum = (k: "openingValue" | "inValue" | "outValue" | "closingValue") => rows.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <ReportHeader title="حركة المخزون" period={`من ${from} إلى ${to}`} filename={`حركة-المخزون-${from}-${to}`} wide note="بالريال السعودي، بالمتوسط المرجّح">
        <PeriodFilter from={from} to={to} today={today}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">المستودع</span>
            <select name="wh" defaultValue={warehouseId ?? ""} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">كل المستودعات</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </PeriodFilter>
      </ReportHeader>
      <RTable name="حركة المخزون" head={["الرمز", "الصنف", "الوحدة", "افتتاحي (كمية)", "افتتاحي (قيمة)", "وارد (كمية)", "وارد (قيمة)", "صادر (كمية)", "صادر (قيمة)", "ختامي (كمية)", "ختامي (قيمة)"]}>
        {rows.length === 0 && (
          <tr>
            <C colSpan={11} className="py-8 text-center text-gray-500">
              لا حركة مخزون
            </C>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.id}>
            <C className="ltr-nums text-xs text-gray-500">{r.code}</C>
            <C>{r.name}</C>
            <C className="text-xs">{r.unit ?? ""}</C>
            <C num>{qty(r.openingQty)}</C>
            <C num>{money(r.openingValue)}</C>
            <C num>{qty(r.inQty)}</C>
            <C num>{money(r.inValue)}</C>
            <C num>{qty(r.outQty)}</C>
            <C num>{money(r.outValue)}</C>
            <C num className="font-semibold">
              {qty(r.closingQty)}
            </C>
            <C num className="font-semibold">
              {money(r.closingValue)}
            </C>
          </tr>
        ))}
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C colSpan={3}>الإجمالي</C>
          <C />
          <C num>{money(sum("openingValue"), false)}</C>
          <C />
          <C num>{money(sum("inValue"), false)}</C>
          <C />
          <C num>{money(sum("outValue"), false)}</C>
          <C />
          <C num>{money(sum("closingValue"), false)}</C>
        </tr>
      </RTable>
      <p className="mt-2 text-xs text-gray-500">التحويل بين المستودعات يظهر وارداً في مستودع وصادراً من الآخر بالقيمة نفسها، فلا يغيّر الختامي.</p>
    </>
  );
}
