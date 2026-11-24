import { asc } from "drizzle-orm";
import { Fragment } from "react";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { generalLedger } from "@/lib/reports";
import { Drill } from "@/components/drill";
import { sourceHref } from "@/lib/source-lines";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, RTable, SourceLink, type ReportParams } from "../report-ui";

/** الأستاذ العام: كل حساب تحرّك في الفترة بحركاته ورصيده المتحرك (للمحاسب). */
export default async function GeneralLedgerPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const prefix = (param(sp, "prefix") ?? "").replace(/\D/g, "").slice(0, 8) || null;
  const ccId = Number(param(sp, "cc")) || null;
  const [accounts, centers] = await Promise.all([
    generalLedger(db, { from, to, prefix, costCenterId: ccId }),
    db.select({ id: s.costCenters.id, name: s.costCenters.nameAr }).from(s.costCenters).orderBy(asc(s.costCenters.code)),
  ]);
  // الرصيد الافتتاحي يفتح قيوده (كل ما قبل الفترة)، والسطور نفسها تفتح القيد والمستند
  const dayBefore = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const openingHref = (code: string, name: string, v: number) => sourceHref({ title: `${code} ${name}: رصيد افتتاحي`, to: dayBefore, codes: [code], costCenterId: ccId ?? undefined, mode: "bal", sign: 1, expected: v });
  return (
    <>
      <ReportHeader title="الأستاذ العام" period={`من ${from} إلى ${to}${prefix ? ` · الحسابات ${prefix}…` : ""}`} filename={`الأستاذ-العام-${from}-${to}`} wide>
        <PeriodFilter from={from} to={to} today={today}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">رقم الحساب أو المجموعة</span>
            <input name="prefix" defaultValue={prefix ?? ""} dir="ltr" placeholder="الكل، أو 5، أو 1101" className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">مركز التكلفة</span>
            <select name="cc" defaultValue={ccId ?? ""} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">الكل</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </PeriodFilter>
      </ReportHeader>
      {accounts.length === 0 ? (
        <p className="rounded-2xl bg-white p-8 text-center text-gray-500 shadow-sm">لا حركة في هذه الفترة.</p>
      ) : (
        <RTable name="الأستاذ العام" head={["التاريخ", "القيد", "المستند", "البيان", "مركز التكلفة", "مدين", "دائن", "الرصيد"]}>
          {accounts.map((a) => (
            <Fragment key={a.account.id}>
              <tr className="bg-brand-50/70 font-semibold text-brand-900 print:break-after-avoid">
                <C colSpan={5}>
                  <span className="ltr-nums">{a.account.code}</span> {a.account.nameAr} · رصيد افتتاحي
                </C>
                <C />
                <C />
                <C num>
                  <Drill href={openingHref(a.account.code, a.account.nameAr, a.opening)}>{money(a.opening, false)}</Drill>
                </C>
              </tr>
              {a.lines.map((l, i) => (
                <tr key={i}>
                  <C className="ltr-nums whitespace-nowrap">{l.entry_date}</C>
                  <C className="ltr-nums text-xs whitespace-nowrap text-gray-500">
                    <a href={`/journal/${l.entry_id}`} className="drill" title="افتح القيد">
                      {l.number}
                    </a>
                  </C>
                  <C className="text-xs whitespace-nowrap">
                    <SourceLink type={l.source_type} id={l.source_id} entryId={l.entry_id} />
                  </C>
                  <C className="max-w-sm">{l.description}</C>
                  <C className="text-xs text-gray-500">{l.cost_center ?? ""}</C>
                  <C num>{money(l.debit)}</C>
                  <C num>{money(l.credit)}</C>
                  <C num className={l.balance < 0 ? "text-red-600" : ""}>
                    {money(l.balance, false)}
                  </C>
                </tr>
              ))}
              <tr className="font-semibold">
                <C colSpan={5}>إجمالي {a.account.nameAr} والرصيد الختامي</C>
                <C num>{money(a.debit, false)}</C>
                <C num>{money(a.credit, false)}</C>
                <C num>{money(a.closing, false)}</C>
              </tr>
            </Fragment>
          ))}
        </RTable>
      )}
      <p className="mt-2 text-xs text-gray-500">الرصيد الموجب مدين والسالب (بين قوسين) دائن.</p>
    </>
  );
}
