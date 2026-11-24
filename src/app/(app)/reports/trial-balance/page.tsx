import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { trialBalance } from "@/lib/reports";
import { Drill } from "@/components/drill";
import { sourceHref } from "@/lib/source-lines";
import { C, money, param, PeriodFilter, periodFrom, ReportHeader, RTable } from "../report-ui";

const LEVELS = [
  { value: "1", label: "الأقسام" },
  { value: "2", label: "المجموعات" },
  { value: "3", label: "الحسابات العامة" },
  { value: "4", label: "كل الحسابات" },
];

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const level = Math.min(4, Math.max(1, Number(param(sp, "level")) || 3));
  const ccId = Number(param(sp, "cc")) || null;
  const [tb, centers] = await Promise.all([
    trialBalance(db, { from, to, costCenterId: ccId }),
    db.select({ id: s.costCenters.id, name: s.costCenters.nameAr }).from(s.costCenters).orderBy(asc(s.costCenters.code)),
  ]);
  const shown = tb.rows.filter((r) => r.account.level <= level && (r.opening || r.debit || r.credit || r.closing));
  const dc = (v: number) => [money(Math.max(v, 0)), money(Math.max(-v, 0))];
  const balanced = tb.totals.debit === tb.totals.credit;
  // «مصدر الرقم» لكل خانة: الافتتاحي رصيد اليوم السابق للفترة، والحركة مدينها أو دائنها، والختامي رصيد آخرها
  const dayBefore = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const cc = ccId ?? undefined;
  const cell = (code: string, name: string, kind: "od" | "oc" | "d" | "c" | "cd" | "cc", expected: number) => {
    const t = `${code} ${name}`;
    const credit = kind === "oc" || kind === "c" || kind === "cc";
    if (kind === "d" || kind === "c") return sourceHref({ title: `${t}: حركة ${credit ? "دائن" : "مدين"}`, from, to, codes: [code], costCenterId: cc, side: credit ? "c" : "d", mode: "net", sign: credit ? -1 : 1, expected });
    return sourceHref({ title: `${t}: رصيد ${kind[0] === "o" ? "افتتاحي" : "ختامي"}`, to: kind[0] === "o" ? dayBefore : to, codes: [code], costCenterId: cc, mode: "bal", sign: credit ? -1 : 1, expected });
  };
  const num = (v: string, href: string) => (v === "—" || v === "0" || v === "" ? v : <Drill href={href}>{v}</Drill>);

  return (
    <>
      <ReportHeader title="ميزان المراجعة" period={`من ${from} إلى ${to}`} filename={`ميزان-المراجعة-${from}-${to}`}>
        <PeriodFilter from={from} to={to} today={today}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">المستوى</span>
            <select name="level" defaultValue={String(level)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
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
      <RTable name="ميزان المراجعة" head={["الرمز", "الحساب", "افتتاحي مدين", "افتتاحي دائن", "حركة مدين", "حركة دائن", "ختامي مدين", "ختامي دائن"]}>
        {shown.length === 0 && (
          <tr>
            <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
              لا توجد حركة في هذه الفترة
            </td>
          </tr>
        )}
        {shown.map((r) => {
          const [od, oc] = dc(r.opening);
          const [cd, ccr] = dc(r.closing);
          const bold = r.account.level < level ? "font-semibold bg-gray-50/70" : "";
          return (
            <tr key={r.account.id} className={bold}>
              <C className="ltr-nums text-gray-500">{r.account.code}</C>
              <C>
                <span style={{ paddingInlineStart: `${(r.account.level - 1) * 14}px` }}>
                  {r.account.isPostable ? (
                    <Link href={`/reports/ledger?account=${r.account.id}&from=${from}&to=${to}`} className="hover:text-brand-700 hover:underline">
                      {r.account.nameAr}
                    </Link>
                  ) : (
                    r.account.nameAr
                  )}
                </span>
              </C>
              <C num>{num(od, cell(r.account.code, r.account.nameAr, "od", Math.max(r.opening, 0)))}</C>
              <C num>{num(oc, cell(r.account.code, r.account.nameAr, "oc", Math.max(-r.opening, 0)))}</C>
              <C num>{num(money(r.debit), cell(r.account.code, r.account.nameAr, "d", r.debit))}</C>
              <C num>{num(money(r.credit), cell(r.account.code, r.account.nameAr, "c", r.credit))}</C>
              <C num>{num(cd, cell(r.account.code, r.account.nameAr, "cd", Math.max(r.closing, 0)))}</C>
              <C num>{num(ccr, cell(r.account.code, r.account.nameAr, "cc", Math.max(-r.closing, 0)))}</C>
            </tr>
          );
        })}
        <tr className="bg-asphalt-900/5 font-bold text-brand-900">
          <C />
          <C>الإجمالي</C>
          <C num>{money(tb.totals.openingDebit, false)}</C>
          <C num>{money(tb.totals.openingCredit, false)}</C>
          <C num>{money(tb.totals.debit, false)}</C>
          <C num>{money(tb.totals.credit, false)}</C>
          <C num>{money(tb.totals.closingDebit, false)}</C>
          <C num>{money(tb.totals.closingCredit, false)}</C>
        </tr>
      </RTable>
      <p className={`mt-3 text-sm ${balanced ? "text-green-700" : "text-red-600"}`}>
        {balanced ? "✓ الميزان متوازن: إجمالي المدين يساوي إجمالي الدائن." : "الميزان غير متوازن؛ راجع القيود."}
        {ccId && " (عند التصفية بمركز تكلفة لا يُشترط التوازن.)"}
      </p>
    </>
  );
}
