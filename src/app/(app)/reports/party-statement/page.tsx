import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { contactStatement } from "@/lib/contacts";
import { customerOptions } from "@/lib/lookups";
import { supplierOptions } from "@/lib/purchases";
import { FormCombo } from "@/components/form-combo";
import { Drill } from "@/components/drill";
import { sourceHref } from "@/lib/source-lines";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, ReportTabs, RTable, SourceLink, withParams, type ReportParams } from "../report-ui";
import { SIDE, sideOf } from "../party-sides";

/**
 * كشف حساب عميل أو مورد: «ملخص» سطر لكل مستند (الفاتورة، السند…)، و«تفاصيل» كل سطر من سطور القيد (بنود الفاتورة وضريبتها).
 * الرصيد موجب = المستحق على العميل أو للمورد.
 */
export default async function PartyStatementPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const side = sideOf(sp);
  const t = SIDE[side];
  const detail = param(sp, "view") === "detail";
  const partyId = Number(param(sp, "party")) || null;
  const [options, party] = await Promise.all([
    side === "customer" ? customerOptions() : supplierOptions(db),
    partyId ? db.select({ id: s.parties.id, name: s.parties.nameAr }).from(s.parties).where(eq(s.parties.id, partyId)).then((r) => r[0]) : null,
  ]);
  const st = party ? await contactStatement(db, party.id, from, to, side) : null;
  const k = side === "customer" ? 1 : -1;
  const dayBefore = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const openingHref = st && party ? sourceHref({ title: `${party.name}: رصيد افتتاحي`, to: dayBefore, codes: [...t.codes], partyId: party.id, mode: "bal", sign: k, expected: st.opening * k }) : undefined;
  // الملخص: سطر لكل قيد بمجموع سطوره
  type Row = NonNullable<typeof st>["rows"][number];
  const rows: Row[] = !st
    ? []
    : detail
      ? st.rows
      : [...st.rows.reduce((m, r) => {
          const prev = m.get(r.entry_id);
          m.set(r.entry_id, prev ? { ...prev, debit: prev.debit + r.debit, credit: prev.credit + r.credit, balance: r.balance } : { ...r, description: r.entry_description ?? r.description });
          return m;
        }, new Map<number, Row>()).values()];

  return (
    <>
      <ReportHeader title={party ? `كشف حساب ${t.one}: ${party.name}` : `كشف حساب ${t.one}`} period={`من ${from} إلى ${to} · ${detail ? "تفاصيل" : "ملخص"}`} filename={`كشف-${t.one}-${party?.name ?? ""}-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today}>
          <input type="hidden" name="side" value={side} />
          {detail && <input type="hidden" name="view" value="detail" />}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">{t.one}</span>
            <div className="w-72 max-w-full">
              <FormCombo name="party" options={options} defaultValue={partyId ? String(partyId) : ""} required placeholder={`اكتب اسم ${t.one}…`} />
            </div>
          </label>
        </PeriodFilter>
      </ReportHeader>
      <ReportTabs
        items={[
          { href: withParams(sp, { side: null, party: null }), label: "العملاء", active: side === "customer" },
          { href: withParams(sp, { side: "supplier", party: null }), label: "الموردون", active: side === "supplier" },
          { href: withParams(sp, { view: null }), label: "ملخص", active: !detail },
          { href: withParams(sp, { view: "detail" }), label: "تفاصيل", active: detail },
        ]}
      />
      {!st ? (
        <p className="rounded-2xl bg-white p-8 text-center text-gray-500 shadow-sm">اختر {t.one} لعرض كشف حسابه.</p>
      ) : (
        <RTable name={`كشف ${t.one}`} head={["التاريخ", "المستند", "القيد", "البيان", "مدين", "دائن", "الرصيد"]}>
          <tr className="bg-gray-50 font-semibold">
            <C className="ltr-nums">{from}</C>
            <C />
            <C />
            <C>رصيد افتتاحي</C>
            <C />
            <C />
            <C num>
              <Drill href={openingHref}>{money(st.opening * k, false)}</Drill>
            </C>
          </tr>
          {rows.map((r, i) => (
            <tr key={i}>
              <C className="ltr-nums whitespace-nowrap">{String(r.entry_date).slice(0, 10)}</C>
              <C className="text-xs whitespace-nowrap">
                <SourceLink type={r.source_type} id={r.source_id} entryId={r.entry_id} />
              </C>
              <C className="ltr-nums text-xs whitespace-nowrap text-gray-500">
                <a href={`/journal/${r.entry_id}`} className="drill" title="افتح القيد">
                  {r.number}
                </a>
              </C>
              <C className="max-w-md">{r.description}</C>
              <C num>{money(r.debit)}</C>
              <C num>{money(r.credit)}</C>
              <C num className="font-medium">
                {money(r.balance * k, false)}
              </C>
            </tr>
          ))}
          <tr className="bg-asphalt-900/5 font-bold text-brand-900">
            <C />
            <C />
            <C />
            <C>الإجمالي و{t.balance}</C>
            <C num>{money(st.debit, false)}</C>
            <C num>{money(st.credit, false)}</C>
            <C num>{money(st.closing * k, false)}</C>
          </tr>
        </RTable>
      )}
    </>
  );
}
