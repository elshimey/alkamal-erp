import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";

// التقارير المالية: كلها من سطور القيود المرحّلة فقط وبالريال (القرار: التقارير من القيود).

const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

type Account = typeof s.accounts.$inferSelect;

async function rows<T>(db: Db, query: ReturnType<typeof sql>) {
  return (await db.execute(query)) as unknown as T[];
}

/** رصيد كل حساب نهائي قبل الفترة وحركته خلالها. */
async function movements(db: Db, from: string, to: string, costCenterId?: number | null) {
  const cc = costCenterId ? sql`and l.cost_center_id = ${costCenterId}` : sql``;
  return rows<{ account_id: number; opening: string; debit: string; credit: string }>(
    db,
    sql`select l.account_id,
          sum(case when e.entry_date < ${from} then l.debit_base - l.credit_base else 0 end) as opening,
          sum(case when e.entry_date >= ${from} then l.debit_base else 0 end) as debit,
          sum(case when e.entry_date >= ${from} then l.credit_base else 0 end) as credit
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        where e.entry_date <= ${to} ${cc}
        group by l.account_id`,
  );
}

export interface TrialRow {
  account: Account;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

/** ميزان المراجعة: الرصيد الافتتاحي والحركة والرصيد الختامي لكل حساب، مجمّعاً على الآباء (مدين موجب). */
export async function trialBalance(db: Db, opts: { from: string; to: string; costCenterId?: number | null }) {
  const accounts = await db.select().from(s.accounts).orderBy(asc(s.accounts.code));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const sums = new Map<number, { opening: number; debit: number; credit: number }>();
  for (const m of await movements(db, opts.from, opts.to, opts.costCenterId)) {
    // يُضاف رصيد الحساب إليه وإلى كل آبائه
    let a = byId.get(Number(m.account_id));
    while (a) {
      const cur = sums.get(a.id) ?? { opening: 0, debit: 0, credit: 0 };
      cur.opening += n(m.opening);
      cur.debit += n(m.debit);
      cur.credit += n(m.credit);
      sums.set(a.id, cur);
      a = a.parentId ? byId.get(a.parentId) : undefined;
    }
  }
  const out: TrialRow[] = accounts.map((account) => {
    const v = sums.get(account.id) ?? { opening: 0, debit: 0, credit: 0 };
    return { account, opening: r2(v.opening), debit: r2(v.debit), credit: r2(v.credit), closing: r2(v.opening + v.debit - v.credit) };
  });
  const top = out.filter((r) => r.account.level === 1);
  const totals = {
    debit: r2(top.reduce((t, r) => t + r.debit, 0)),
    credit: r2(top.reduce((t, r) => t + r.credit, 0)),
    openingDebit: r2(top.reduce((t, r) => t + Math.max(r.opening, 0), 0)),
    openingCredit: r2(top.reduce((t, r) => t + Math.max(-r.opening, 0), 0)),
    closingDebit: r2(top.reduce((t, r) => t + Math.max(r.closing, 0), 0)),
    closingCredit: r2(top.reduce((t, r) => t + Math.max(-r.closing, 0), 0)),
  };
  return { rows: out, totals };
}

// ───────────── قائمة الدخل ─────────────

/** صافي كل حساب عام (4 أرقام) خلال الفترة بطبيعته: الإيراد دائن موجب، والتكلفة مدين موجب. */
async function netByGeneralAccount(db: Db, from: string, to: string) {
  const r = await rows<{ code: string; name: string; net: string }>(
    db,
    sql`select g.code, g.name_ar as name, sum(l.debit_base - l.credit_base) as net
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        join accounts a on a.id = l.account_id
        join accounts g on g.code = left(a.code, 4)
        where e.entry_date between ${from} and ${to} and a.code ~ '^[4-7]'
        group by g.code, g.name_ar`,
  );
  return new Map(r.map((x) => [x.code, { name: x.name, net: n(x.net) }]));
}

export const INCOME_SECTIONS = [
  { key: "revenue", label: "الإيرادات", prefix: "4", sign: -1 },
  { key: "cost", label: "تكلفة الإيراد", prefix: "5", sign: 1 },
  { key: "admin", label: "المصروفات الإدارية والعمومية", prefix: "6", sign: 1 },
  { key: "finance", label: "تكاليف التمويل والبنود الأخرى", prefix: "71", sign: 1 },
  { key: "zakat", label: "الزكاة", prefix: "72", sign: 1 },
] as const;

export interface IncomeLine {
  code: string;
  name: string;
  current: number;
  previous: number | null;
}

/** قائمة الدخل بتبويب الوظيفة (IAS 1) مع مقارنة اختيارية بفترة سابقة. */
export async function incomeStatement(db: Db, opts: { from: string; to: string; compareFrom?: string | null; compareTo?: string | null }) {
  const general = await db
    .select({ code: s.accounts.code, name: s.accounts.nameAr })
    .from(s.accounts)
    .where(and(eq(s.accounts.level, 3), sql`${s.accounts.code} ~ '^[4-7]'`))
    .orderBy(asc(s.accounts.code));
  const cur = await netByGeneralAccount(db, opts.from, opts.to);
  const prev = opts.compareFrom && opts.compareTo ? await netByGeneralAccount(db, opts.compareFrom, opts.compareTo) : null;
  const sections = INCOME_SECTIONS.map((sec) => {
    const lines: IncomeLine[] = general
      .filter((g) => g.code.startsWith(sec.prefix))
      .map((g) => ({
        code: g.code,
        name: g.name,
        current: r2(sec.sign * (cur.get(g.code)?.net ?? 0)),
        previous: prev ? r2(sec.sign * (prev.get(g.code)?.net ?? 0)) : null,
      }))
      .filter((l) => l.current !== 0 || (l.previous ?? 0) !== 0);
    const total = (k: "current" | "previous") => r2(lines.reduce((t, l) => t + (l[k] ?? 0), 0));
    return { ...sec, lines, current: total("current"), previous: prev ? total("previous") : null };
  });
  const get = (key: string, k: "current" | "previous") => sections.find((x) => x.key === key)![k] ?? 0;
  const calc = (k: "current" | "previous") => {
    const gross = r2(get("revenue", k) - get("cost", k));
    const operating = r2(gross - get("admin", k));
    const beforeZakat = r2(operating - get("finance", k));
    const net = r2(beforeZakat - get("zakat", k));
    return { gross, operating, beforeZakat, net };
  };
  return { sections, current: calc("current"), previous: prev ? calc("previous") : null };
}

// ───────────── قائمة المركز المالي ─────────────

export const BALANCE_SECTIONS = [
  { key: "currentAssets", label: "الأصول المتداولة", prefix: "11", side: "assets" },
  { key: "nonCurrentAssets", label: "الأصول غير المتداولة", prefix: "12", side: "assets" },
  { key: "currentLiabilities", label: "الالتزامات المتداولة", prefix: "21", side: "liabilities" },
  { key: "nonCurrentLiabilities", label: "الالتزامات غير المتداولة", prefix: "22", side: "liabilities" },
  { key: "equity", label: "حقوق الملكية", prefix: "31", side: "equity" },
] as const;

/** المركز المالي في تاريخ: الأرصدة التراكمية، وربح السنة الجارية وما قبلها محسوبان من حسابات الدخل. */
export async function balanceSheet(db: Db, asOf: string) {
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const r = await rows<{ code: string; name: string; balance: string }>(
    db,
    sql`select g.code, g.name_ar as name, sum(l.debit_base - l.credit_base) as balance
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        join accounts a on a.id = l.account_id
        join accounts g on g.code = left(a.code, 4)
        where e.entry_date <= ${asOf} and a.code ~ '^[1-3]'
        group by g.code, g.name_ar
        order by g.code`,
  );
  const [pl] = await rows<{ prior: string; current: string }>(
    db,
    sql`select
          coalesce(sum(case when e.entry_date < ${yearStart} then l.credit_base - l.debit_base else 0 end), 0) as prior,
          coalesce(sum(case when e.entry_date >= ${yearStart} then l.credit_base - l.debit_base else 0 end), 0) as current
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        join accounts a on a.id = l.account_id
        where e.entry_date <= ${asOf} and a.code ~ '^[4-7]'`,
  );
  const sections = BALANCE_SECTIONS.map((sec) => {
    // الأصول بطبيعتها مدينة، والالتزامات وحقوق الملكية دائنة
    const sign = sec.side === "assets" ? 1 : -1;
    const lines = r
      .filter((x) => x.code.startsWith(sec.prefix))
      .map((x) => ({ code: x.code, name: x.name, amount: r2(sign * n(x.balance)) }))
      .filter((l) => l.amount !== 0);
    if (sec.key === "equity") {
      if (r2(n(pl.prior)) !== 0) lines.push({ code: "", name: "أرباح (خسائر) السنوات السابقة غير المقفلة", amount: r2(n(pl.prior)) });
      lines.push({ code: "", name: "صافي ربح (خسارة) السنة الجارية", amount: r2(n(pl.current)) });
    }
    return { ...sec, lines, total: r2(lines.reduce((t, l) => t + l.amount, 0)) };
  });
  const side = (k: string) => r2(sections.filter((x) => x.side === k).reduce((t, x) => t + x.total, 0));
  const assets = side("assets");
  const liabilities = side("liabilities");
  const equity = side("equity");
  return { sections, assets, liabilities, equity, difference: r2(assets - liabilities - equity) };
}

// ───────────── كشف الحساب ─────────────

/** كشف حساب (أو حساب تجميعي بكل فروعه) برصيد افتتاحي ورصيد متحرك، مع تصفية اختيارية بمركز تكلفة. */
export async function accountLedger(db: Db, opts: { accountId: number; from: string; to: string; costCenterId?: number | null }) {
  const [account] = await db.select().from(s.accounts).where(eq(s.accounts.id, opts.accountId));
  if (!account) throw new Error("الحساب غير موجود");
  const cc = opts.costCenterId ? sql`and l.cost_center_id = ${opts.costCenterId}` : sql``;
  const scope = sql`a.code like ${account.code + "%"} ${cc}`;
  const [open] = await rows<{ opening: string }>(
    db,
    sql`select coalesce(sum(l.debit_base - l.credit_base), 0) as opening
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        join accounts a on a.id = l.account_id
        where ${scope} and e.entry_date < ${opts.from}`,
  );
  const lines = await rows<{
    entry_id: number;
    number: string;
    entry_date: string;
    source_type: string | null;
    source_id: number | null;
    description: string | null;
    entry_description: string | null;
    account_code: string;
    account_name: string;
    cost_center: string | null;
    debit: string;
    credit: string;
    currency_code: string;
    amount: string;
  }>(
    db,
    sql`select e.id as entry_id, e.number, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, e.source_type, e.source_id,
          l.description, e.description as entry_description, a.code as account_code, a.name_ar as account_name,
          cc.name_ar as cost_center, l.debit_base as debit, l.credit_base as credit, l.currency_code,
          (l.debit + l.credit) as amount
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        join accounts a on a.id = l.account_id
        left join cost_centers cc on cc.id = l.cost_center_id
        where ${scope} and e.entry_date between ${opts.from} and ${opts.to}
        order by e.entry_date, e.id, l.line_no`,
  );
  let balance = r2(n(open.opening));
  const opening = balance;
  const out = lines.map((l) => {
    balance = r2(balance + n(l.debit) - n(l.credit));
    return { ...l, debit: n(l.debit), credit: n(l.credit), amount: n(l.amount), balance };
  });
  return {
    account,
    opening,
    lines: out,
    debit: r2(out.reduce((t, l) => t + l.debit, 0)),
    credit: r2(out.reduce((t, l) => t + l.credit, 0)),
    closing: balance,
  };
}

// ───────────── مراكز التكلفة ─────────────

/** ربحية كل مركز تكلفة: الإيراد والتكلفة المباشرة والمصروفات الموزعة عليه في الفترة. */
export async function costCenterProfit(db: Db, from: string, to: string) {
  const r = await rows<{ id: number; code: string; name: string; type: string; revenue: string; direct: string; other: string }>(
    db,
    sql`select cc.id, cc.code, cc.name_ar as name, cc.type,
          coalesce(sum(case when a.code like '4%' then l.credit_base - l.debit_base end), 0) as revenue,
          coalesce(sum(case when a.code like '5%' then l.debit_base - l.credit_base end), 0) as direct,
          coalesce(sum(case when a.code ~ '^[67]' then l.debit_base - l.credit_base end), 0) as other
        from cost_centers cc
        left join journal_lines l on l.cost_center_id = cc.id
          and exists (select 1 from journal_entries e where e.id = l.entry_id and e.status = 'posted' and e.entry_date between ${from} and ${to})
        left join accounts a on a.id = l.account_id
        group by cc.id
        order by cc.type, cc.code`,
  );
  return r
    .map((x) => {
      const revenue = r2(n(x.revenue));
      const direct = r2(n(x.direct));
      const other = r2(n(x.other));
      const profit = r2(revenue - direct - other);
      return { id: Number(x.id), code: x.code, name: x.name, type: x.type, revenue, direct, other, profit, margin: revenue ? r2((profit / revenue) * 100) : null };
    })
    .filter((x) => x.revenue || x.direct || x.other);
}

// ───────────── إقرار ضريبة القيمة المضافة ─────────────

/**
 * ملخص الإقرار: المبيعات الخاضعة بالنسبة الأساسية والصفرية من الفواتير الصادرة،
 * وضريبة المخرجات والمدخلات من القيود (رصيد 2109 و1108 خلال الفترة).
 */
export async function vatReturn(db: Db, from: string, to: string) {
  const [sales] = await rows<{ standard: string; standard_vat: string; zero: string }>(
    db,
    sql`select
          coalesce(sum(case when sl.vat_rate > 0 then sl.amount * si.exchange_rate end), 0) as standard,
          coalesce(sum(case when sl.vat_rate > 0 then sl.vat_amount * si.exchange_rate end), 0) as standard_vat,
          coalesce(sum(case when sl.vat_rate = 0 then sl.amount * si.exchange_rate end), 0) as zero
        from sales_invoice_lines sl
        join sales_invoices si on si.id = sl.invoice_id
        where si.status <> 'draft' and si.invoice_date between ${from} and ${to}`,
  );
  const [vat] = await rows<{ output: string; input: string }>(
    db,
    sql`select
          coalesce(sum(case when a.code like '2109%' then l.credit_base - l.debit_base end), 0) as output,
          coalesce(sum(case when a.code like '1108%' then l.debit_base - l.credit_base end), 0) as input
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        join accounts a on a.id = l.account_id
        where e.entry_date between ${from} and ${to}`,
  );
  const output = r2(n(vat.output));
  const input = r2(n(vat.input));
  return {
    standardSales: r2(n(sales.standard)),
    standardSalesVat: r2(n(sales.standard_vat)),
    zeroRatedSales: r2(n(sales.zero)),
    output,
    // المشتريات الخاضعة بالنسبة الأساسية مستنتجة من ضريبتها (15%)
    standardPurchases: r2(input / 0.15),
    input,
    net: r2(output - input),
  };
}

/** الفترات الجاهزة لمرشحات التقارير. */
export function presetRanges(today: string) {
  const [y, m] = today.split("-").map(Number);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const q = Math.floor((m - 1) / 3);
  return [
    { key: "month", label: "هذا الشهر", from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) },
    { key: "last-month", label: "الشهر الماضي", from: iso(new Date(Date.UTC(y, m - 2, 1))), to: iso(new Date(Date.UTC(y, m - 1, 0))) },
    { key: "quarter", label: "هذا الربع", from: iso(new Date(Date.UTC(y, q * 3, 1))), to: iso(new Date(Date.UTC(y, q * 3 + 3, 0))) },
    { key: "year", label: "هذه السنة", from: `${y}-01-01`, to: `${y}-12-31` },
    { key: "last-year", label: "السنة الماضية", from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}

/** نفس طول الفترة قبلها مباشرة، للمقارنة. */
export function previousRange(from: string, to: string) {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  // فترة بأشهر كاملة تُقارن بالأشهر نفسها قبلها
  if (f.getUTCDate() === 1 && new Date(t.getTime() + 86_400_000).getUTCDate() === 1) {
    const months = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + t.getUTCMonth() - f.getUTCMonth() + 1;
    return { from: iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - months, 1))), to: iso(new Date(f.getTime() - 86_400_000)) };
  }
  const days = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1;
  return { from: iso(new Date(f.getTime() - days * 86_400_000)), to: iso(new Date(f.getTime() - 86_400_000)) };
}
