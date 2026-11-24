import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { accountLedger } from "@/lib/reports";
import { Drill } from "@/components/drill";
import { sourceHref } from "@/lib/source-lines";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, RTable, SourceLink } from "../report-ui";
import { FormCombo } from "@/components/form-combo";
import { toAccountOptions } from "@/lib/lookups";

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const accountId = Number(param(sp, "account")) || null;
  const ccId = Number(param(sp, "cc")) || null;
  const [accounts, centers] = await Promise.all([
    db.select({ id: s.accounts.id, code: s.accounts.code, name: s.accounts.nameAr, level: s.accounts.level }).from(s.accounts).orderBy(asc(s.accounts.code)),
    db.select({ id: s.costCenters.id, name: s.costCenters.nameAr }).from(s.costCenters).orderBy(asc(s.costCenters.code)),
  ]);
  const ledger = accountId ? await accountLedger(db, { accountId, from, to, costCenterId: ccId }) : null;
  const multi = ledger && !ledger.account.isPostable;
  // بطاقات الكشف تفتح «مصدر الرقم» بنفس الحساب ومركز التكلفة: الافتتاحي ما قبل الفترة، والمدين والدائن والختامي
  const dayBefore = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const acc = ledger ? `${ledger.account.code} ${ledger.account.nameAr}` : "";
  const base = ledger ? { codes: [ledger.account.code], costCenterId: ccId ?? undefined } : {};
  const cards = ledger
    ? {
        opening: sourceHref({ title: `${acc}: رصيد افتتاحي`, to: dayBefore, ...base, mode: "bal", sign: 1, expected: ledger.opening }),
        debit: sourceHref({ title: `${acc}: المدين`, from, to, ...base, side: "d", mode: "net", sign: 1, expected: ledger.debit }),
        credit: sourceHref({ title: `${acc}: الدائن`, from, to, ...base, side: "c", mode: "net", sign: -1, expected: ledger.credit }),
        closing: sourceHref({ title: `${acc}: رصيد ختامي`, from, to, ...base, mode: "bal", sign: 1, expected: ledger.closing }),
      }
    : null;

  return (
    <>
      <ReportHeader
        title={ledger ? `كشف حساب: ${ledger.account.code} ${ledger.account.nameAr}` : "كشف حساب"}
        period={`من ${from} إلى ${to}`}
        filename={`كشف-حساب-${ledger?.account.code ?? ""}-${from}-${to}`}
      >
        <PeriodFilter from={from} to={to} today={today}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">الحساب</span>
            <div className="w-72 max-w-full">
              <FormCombo name="account" options={await toAccountOptions(accounts.map((a) => ({ id: a.id, code: a.code, nameAr: a.name })))} defaultValue={accountId ? String(accountId) : ""} required placeholder="ابحث باسم الحساب أو رقمه…" />
            </div>
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
      {!ledger ? (
        <p className="rounded-2xl bg-white p-8 text-center text-gray-500 shadow-sm">اختر حساباً لعرض كشفه. الحساب التجميعي يعرض حركة كل حساباته الفرعية.</p>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4 print:hidden">
            {[
              { label: "الرصيد الافتتاحي", v: ledger.opening, href: cards?.opening },
              { label: "إجمالي المدين", v: ledger.debit, href: cards?.debit },
              { label: "إجمالي الدائن", v: ledger.credit, href: cards?.credit },
              { label: "الرصيد الختامي", v: ledger.closing, strong: true, href: cards?.closing },
            ].map((k) => (
              <Drill key={k.label} href={k.href} card className={`block rounded-2xl p-4 shadow-sm ${k.strong ? "bg-asphalt-900 text-white" : "bg-white"}`}>
                <div className={`text-xs ${k.strong ? "text-white/70" : "text-gray-500"}`}>{k.label}</div>
                <div className="ltr-nums mt-1 text-xl font-semibold">{money(k.v, false)}</div>
                <div className={`text-xs ${k.strong ? "text-white/60" : "text-gray-400"}`}>{k.v > 0 ? "مدين" : k.v < 0 ? "دائن" : ""}</div>
              </Drill>
            ))}
          </div>
          <RTable name="كشف الحساب" head={["التاريخ", "القيد", "المستند", ...(multi ? ["الحساب"] : []), "البيان", "مركز التكلفة", "مدين", "دائن", "الرصيد"]}>
            <tr className="bg-gray-50 font-semibold">
              <C className="ltr-nums">{from}</C>
              <C />
              <C />
              {multi && <C />}
              <C>رصيد افتتاحي</C>
              <C />
              <C />
              <C />
              <C num>
                <Drill href={cards?.opening}>{money(ledger.opening, false)}</Drill>
              </C>
            </tr>
            {ledger.lines.map((l, i) => {
              return (
                <tr key={i}>
                  <C className="ltr-nums whitespace-nowrap">{l.entry_date}</C>
                  <C className="ltr-nums text-xs whitespace-nowrap text-gray-500"><a href={`/journal/${l.entry_id}`} className="drill">{l.number}</a></C>
                  <C className="text-xs whitespace-nowrap">
                    <SourceLink type={l.source_type} id={l.source_id} entryId={l.entry_id} />
                  </C>
                  {multi && <C className="text-xs">{l.account_name}</C>}
                  <C className="max-w-sm">
                    {l.description ?? l.entry_description}
                    {l.currency_code !== "SAR" && <span className="ltr-nums ms-1 text-xs text-gray-400">({l.amount.toLocaleString("en")} {l.currency_code})</span>}
                  </C>
                  <C className="text-xs text-gray-500">{l.cost_center ?? ""}</C>
                  <C num>{money(l.debit)}</C>
                  <C num>{money(l.credit)}</C>
                  <C num className={`font-medium ${l.balance < 0 ? "text-red-600" : ""}`}>{money(l.balance, false)}</C>
                </tr>
              );
            })}
            <tr className="bg-asphalt-900/5 font-bold text-brand-900">
              <C />
              <C />
              <C />
              {multi && <C />}
              <C>الإجمالي والرصيد الختامي</C>
              <C />
              <C num>{money(ledger.debit, false)}</C>
              <C num>{money(ledger.credit, false)}</C>
              <C num>{money(ledger.closing, false)}</C>
            </tr>
          </RTable>
          <p className="mt-2 text-xs text-gray-500">الرصيد الموجب مدين والسالب (بين قوسين) دائن.</p>
        </>
      )}
    </>
  );
}
