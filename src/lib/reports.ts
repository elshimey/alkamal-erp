import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { TAX_BEHAVIORS, type TaxBehaviorKey } from "@/data/tax-codes";

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
        join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
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
          and exists (select 1 from journal_entries e where e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close' and e.entry_date between ${from} and ${to})
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
export interface VatBox {
  behavior: string;
  label: string;
  amount: number;
  adjust: number;
  vat: number;
}

/**
 * إقرار ضريبة القيمة المضافة بخانات الهيئة: كل نوع ضريبة (حسب «يتصرف مثل») في خانته.
 * المبيعات من الفواتير الصادرة، وتعديلاتها من الإشعارات المرحّلة. ضريبة المشتريات الخاضعة من دفتر 1108
 * (كل المصادر: فواتير الموردين والمصروفات والصيانة)، والمشتريات الصفرية والمعفاة من فواتير الموردين.
 * الإجماليان (المخرجات والمدخلات) من الحسابين 2109 و1108 مباشرة.
 */
export async function vatReturn(db: Db, from: string, to: string) {
  const fallbackSales = sql.raw(`case when coalesce(t.behavior, '') <> '' then t.behavior when l.vat_rate > 0 then 'standard' else 'zero' end`);
  const salesRows = await rows<{ behavior: string; amount: string; adjust: string; vat: string }>(
    db,
    sql`select b.behavior, sum(b.amount) as amount, sum(b.adjust) as adjust, sum(b.vat) as vat from (
          select ${fallbackSales} as behavior, l.amount * si.exchange_rate as amount, 0 as adjust, l.vat_amount * si.exchange_rate as vat
          from sales_invoice_lines l join sales_invoices si on si.id = l.invoice_id left join tax_codes t on t.id = l.tax_code_id
          where si.status <> 'draft' and si.invoice_date between ${from} and ${to}
          union all
          select ${fallbackSales}, 0, (case when n.kind = 'sales_credit' then -1 else 1 end) * l.amount * n.exchange_rate,
                 (case when n.kind = 'sales_credit' then -1 else 1 end) * l.vat_amount * n.exchange_rate
          from adjustment_note_lines l join adjustment_notes n on n.id = l.note_id left join tax_codes t on t.id = l.tax_code_id
          where n.status = 'posted' and n.kind in ('sales_credit', 'sales_debit') and n.note_date between ${from} and ${to}
        ) b group by b.behavior`,
  );
  // ضريبة المدخلات بنوعها من الدفتر؛ السطر دون نوع يُعد ضريبة مشتريات أساسية
  const inputRows = await rows<{ behavior: string; vat: string }>(
    db,
    sql`select coalesce(nullif(t.behavior, ''), 'pur_standard') as behavior, sum(l.debit_base - l.credit_base) as vat
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        join accounts a on a.id = l.account_id
        left join tax_codes t on t.id = l.tax_code_id
        where a.code like '1108%' and e.entry_date between ${from} and ${to}
        group by 1`,
  );
  const zeroPurchases = await rows<{ behavior: string; amount: string }>(
    db,
    sql`select t.behavior, sum(l.amount * pi.exchange_rate) as amount
        from purchase_invoice_lines l join purchase_invoices pi on pi.id = l.invoice_id join tax_codes t on t.id = l.tax_code_id
        where pi.status = 'posted' and pi.invoice_date between ${from} and ${to} and t.behavior in ('pur_zero', 'pur_exempt', 'out_of_scope')
        group by t.behavior`,
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
  const label = (b: string) => (b in TAX_BEHAVIORS ? TAX_BEHAVIORS[b as TaxBehaviorKey].box : b);
  const SALES_ORDER = ["standard", "zero", "export", "exempt", "out_of_scope"];
  const sales: VatBox[] = SALES_ORDER.map((b) => {
    const r = salesRows.find((x) => x.behavior === b);
    return { behavior: b, label: label(b), amount: r2(n(r?.amount)), adjust: r2(n(r?.adjust)), vat: r2(n(r?.vat)) };
  });
  const PURCHASE_ORDER = ["pur_standard", "customs", "reverse", "pur_zero", "pur_exempt", "out_of_scope"];
  const purchases: VatBox[] = PURCHASE_ORDER.map((b) => {
    const vatIn = r2(n(inputRows.find((x) => x.behavior === b)?.vat));
    const amount = vatIn ? r2(vatIn / 0.15) : r2(n(zeroPurchases.find((x) => x.behavior === b)?.amount));
    return { behavior: b, label: label(b), amount, adjust: 0, vat: vatIn };
  });
  const output = r2(n(vat.output));
  const input = r2(n(vat.input));
  const std = sales.find((x) => x.behavior === "standard")!;
  return {
    sales,
    purchases,
    standardSales: r2(std.amount + std.adjust),
    standardSalesVat: r2(std.vat),
    zeroRatedSales: r2(sales.filter((x) => x.behavior !== "standard").reduce((t, x) => t + x.amount + x.adjust, 0)),
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

// ───────────── مركز التقارير (الخطوة 4ب، تقسيم وافق) ─────────────

/**
 * الأستاذ العام: كل حساب تفصيلي تحرّك في الفترة (أو له رصيد افتتاحي) برصيده الافتتاحي وحركاته ورصيده الختامي.
 * prefix يحصره في مجموعة (مثل 5 أو 1101).
 */
export async function generalLedger(db: Db, opts: { from: string; to: string; prefix?: string | null; costCenterId?: number | null }) {
  const cc = opts.costCenterId ? sql`and l.cost_center_id = ${opts.costCenterId}` : sql``;
  const pre = opts.prefix ? sql`and a.code like ${opts.prefix + "%"}` : sql``;
  const [openings, lines] = await Promise.all([
    rows<{ account_id: number; opening: string }>(
      db,
      sql`select l.account_id, sum(l.debit_base - l.credit_base) as opening
          from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.id = l.account_id
          where e.entry_date < ${opts.from} ${pre} ${cc} group by l.account_id`,
    ),
    rows<{ account_id: number; entry_id: number; number: string; entry_date: string; source_type: string | null; source_id: number | null; description: string | null; cost_center: string | null; debit: string; credit: string }>(
      db,
      sql`select l.account_id, e.id as entry_id, e.number, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, e.source_type, e.source_id,
            coalesce(l.description, e.description) as description, cc.name_ar as cost_center, l.debit_base as debit, l.credit_base as credit
          from journal_lines l join journal_entries e on e.id = l.entry_id and e.status = 'posted' join accounts a on a.id = l.account_id
          left join cost_centers cc on cc.id = l.cost_center_id
          where e.entry_date between ${opts.from} and ${opts.to} ${pre} ${cc}
          order by a.code, e.entry_date, e.id, l.line_no`,
    ),
  ]);
  const ids = new Set([...openings.filter((o) => Math.abs(n(o.opening)) > 0.005).map((o) => Number(o.account_id)), ...lines.map((l) => Number(l.account_id))]);
  if (!ids.size) return [];
  const accounts = await db.select().from(s.accounts).where(sql`${s.accounts.id} in (${sql.join([...ids].map((i) => sql`${i}`), sql`, `)})`).orderBy(asc(s.accounts.code));
  const openOf = new Map(openings.map((o) => [Number(o.account_id), r2(n(o.opening))]));
  return accounts.map((account) => {
    let balance = openOf.get(account.id) ?? 0;
    const opening = balance;
    const out = lines
      .filter((l) => Number(l.account_id) === account.id)
      .map((l) => {
        balance = r2(balance + n(l.debit) - n(l.credit));
        return { ...l, debit: n(l.debit), credit: n(l.credit), balance };
      });
    return { account, opening, lines: out, debit: r2(out.reduce((t, l) => t + l.debit, 0)), credit: r2(out.reduce((t, l) => t + l.credit, 0)), closing: balance };
  });
}

export type PartySide = "customer" | "supplier";
const RECEIVABLE = "1103";
const PAYABLES = ["2101", "2102", "2103", "2104", "2105"];
/** حسابات الجهة: العملاء على 1103، والموردون على 2101–2105 (لا 2109 الضريبة)، كما في بطاقة جهة الاتصال. */
const sideAccounts = (side: PartySide) => (side === "customer" ? sql`a.code = ${RECEIVABLE}` : sql`a.code in (${sql.join(PAYABLES.map((c) => sql`${c}`), sql`, `)})`);
/** العميل رصيده مدين والمورد رصيده دائن: الإشارة تجعل «ما له أو عليه» موجباً في الحالتين. */
const sign = (side: PartySide) => (side === "customer" ? 1 : -1);

/** أرصدة العملاء أو الموردين: الافتتاحي والمدين والدائن والختامي لكل جهة في الفترة، من القيود المرحّلة. */
export async function partyBalances(db: Db, opts: { side: PartySide; from: string; to: string }) {
  const r = await rows<{ id: number; name: string; opening: string; debit: string; credit: string }>(
    db,
    sql`select p.id, p.name_ar as name,
          coalesce(sum(l.debit_base - l.credit_base) filter (where e.entry_date < ${opts.from}), 0) as opening,
          coalesce(sum(l.debit_base) filter (where e.entry_date >= ${opts.from}), 0) as debit,
          coalesce(sum(l.credit_base) filter (where e.entry_date >= ${opts.from}), 0) as credit
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted'
        join accounts a on a.id = l.account_id
        join parties p on p.id = l.party_id
        where ${sideAccounts(opts.side)} and e.entry_date <= ${opts.to}
        group by p.id, p.name_ar
        order by p.name_ar`,
  );
  const k = sign(opts.side);
  return r
    .map((x) => {
      const opening = r2(n(x.opening) * k);
      const debit = r2(n(x.debit));
      const credit = r2(n(x.credit));
      return { id: Number(x.id), name: x.name, opening, debit, credit, closing: r2(opening + (debit - credit) * k) };
    })
    .filter((x) => x.opening || x.debit || x.credit);
}

/**
 * أعمار الديون المدينة أو الدائنة في تاريخ: الفواتير المفتوحة (العملاء من فواتير المبيعات، والموردون من فواتير الموردين)
 * حسب أيام التأخير عن الاستحقاق، وبجانبها رصيد الدفتر؛ والفرق «غير مربوط بفاتورة» (دفعات مقدمة أو أرصدة افتتاحية أو قيود يدوية).
 */
export async function partyAging(db: Db, opts: { side: PartySide; asOf: string }) {
  const docs = opts.side === "customer" ? sql`sales_invoices` : sql`purchase_invoices`;
  const partyCol = opts.side === "customer" ? sql`customer_id` : sql`supplier_id`;
  const status = opts.side === "customer" ? sql`status = 'issued'` : sql`status = 'posted'`;
  const [aging, ledger] = await Promise.all([
    rows<{ id: number; name: string; current: string; d30: string; d60: string; d90: string; over: string; count: number }>(
      db,
      sql`select p.id, p.name_ar as name, count(*)::int as count,
            coalesce(sum(o) filter (where due_date >= ${opts.asOf}), 0) as current,
            coalesce(sum(o) filter (where ${opts.asOf}::date - due_date between 1 and 30), 0) as d30,
            coalesce(sum(o) filter (where ${opts.asOf}::date - due_date between 31 and 60), 0) as d60,
            coalesce(sum(o) filter (where ${opts.asOf}::date - due_date between 61 and 90), 0) as d90,
            coalesce(sum(o) filter (where ${opts.asOf}::date - due_date > 90), 0) as over
          from (select ${partyCol} as party_id, due_date, (total - paid_amount) * exchange_rate as o from ${docs}
                where ${status} and paid_amount < total and invoice_date <= ${opts.asOf}) x
          join parties p on p.id = x.party_id
          group by p.id, p.name_ar`,
    ),
    partyBalances(db, { side: opts.side, from: opts.asOf, to: opts.asOf }),
  ]);
  const byId = new Map(aging.map((a) => [Number(a.id), a]));
  const ids = new Set([...aging.map((a) => Number(a.id)), ...ledger.map((l) => l.id)]);
  const names = new Map([...aging.map((a) => [Number(a.id), a.name] as const), ...ledger.map((l) => [l.id, l.name] as const)]);
  const balance = new Map(ledger.map((l) => [l.id, l.closing]));
  return [...ids]
    .map((id) => {
      const a = byId.get(id);
      const buckets = { current: r2(n(a?.current)), d30: r2(n(a?.d30)), d60: r2(n(a?.d60)), d90: r2(n(a?.d90)), over: r2(n(a?.over)) };
      const open = r2(buckets.current + buckets.d30 + buckets.d60 + buckets.d90 + buckets.over);
      const ledgerBalance = balance.get(id) ?? 0;
      return { id, name: names.get(id) ?? "", count: Number(a?.count ?? 0), ...buckets, open, ledger: ledgerBalance, unlinked: r2(ledgerBalance - open) };
    })
    .filter((x) => x.open || x.ledger)
    .sort((a, b) => b.ledger - a.ledger);
}

/**
 * المبيعات حسب العميل من القيود المرحّلة: الإيراد (4xxx) والمصاريف المستردة (1114) والضريبة (2109) على سطور العميل.
 * المشتريات حسب المورد: ما قُيد دائناً على ذمته (عدا السداد) والضريبة (1108) على سطوره.
 */
export async function salesByCustomer(db: Db, from: string, to: string) {
  const r = await rows<{ id: number; name: string; revenue: string; recharged: string; vat: string; invoices: number }>(
    db,
    sql`select p.id, p.name_ar as name,
          coalesce(sum(l.credit_base - l.debit_base) filter (where a.code like '4%'), 0) as revenue,
          coalesce(sum(l.credit_base - l.debit_base) filter (where a.code = '1114'), 0) as recharged,
          coalesce(sum(l.credit_base - l.debit_base) filter (where a.code = '2109'), 0) as vat,
          count(distinct e.id) filter (where e.source_type = 'sales_invoice')::int as invoices
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
        join accounts a on a.id = l.account_id
        join parties p on p.id = l.party_id
        where e.entry_date between ${from} and ${to} and (a.code like '4%' or a.code in ('1114', '2109'))
          and exists (select 1 from journal_lines x join accounts xa on xa.id = x.account_id where x.entry_id = e.id and xa.code = ${RECEIVABLE})
        group by p.id, p.name_ar`,
  );
  return r
    .map((x) => {
      const revenue = r2(n(x.revenue));
      const recharged = r2(n(x.recharged));
      const vat = r2(n(x.vat));
      return { id: Number(x.id), name: x.name, invoices: Number(x.invoices), revenue, recharged, vat, total: r2(revenue + recharged + vat) };
    })
    .filter((x) => x.revenue || x.recharged || x.vat)
    .sort((a, b) => b.total - a.total);
}

export async function purchasesBySupplier(db: Db, from: string, to: string) {
  const r = await rows<{ id: number; name: string; gross: string; vat: string; bills: number }>(
    db,
    sql`select p.id, p.name_ar as name,
          coalesce(sum(l.credit_base - l.debit_base) filter (where ${sideAccounts("supplier")}), 0) as gross,
          coalesce(sum(l.debit_base - l.credit_base) filter (where a.code = '1108'), 0) as vat,
          count(distinct e.id) filter (where e.source_type = 'purchase_invoice')::int as bills
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
          and e.source_type is distinct from 'payment'
        join accounts a on a.id = l.account_id
        join parties p on p.id = l.party_id
        where e.entry_date between ${from} and ${to} and (${sideAccounts("supplier")} or a.code = '1108')
        group by p.id, p.name_ar`,
  );
  return r
    .map((x) => {
      const gross = r2(n(x.gross));
      const vat = r2(n(x.vat));
      return { id: Number(x.id), name: x.name, bills: Number(x.bills), net: r2(gross - vat), vat, total: gross };
    })
    .filter((x) => x.total || x.vat)
    .sort((a, b) => b.total - a.total);
}

/** سجل التدقيق: كل إنشاء وتعديل وحذف مع المستخدم والوقت (من مشغّل audit_row في قاعدة البيانات). */
export async function auditTrail(db: Db, opts: { from: string; to: string; userId?: number | null; entity?: string | null; limit?: number }) {
  const where = [sql`${s.auditLog.at} >= ${opts.from}::date`, sql`${s.auditLog.at} < ${opts.to}::date + 1`];
  if (opts.userId) where.push(eq(s.auditLog.userId, opts.userId));
  if (opts.entity) where.push(eq(s.auditLog.entity, opts.entity));
  return db
    .select({ id: s.auditLog.id, entity: s.auditLog.entity, entityId: s.auditLog.entityId, action: s.auditLog.action, changes: s.auditLog.changes, at: s.auditLog.at, user: s.users.name })
    .from(s.auditLog)
    .leftJoin(s.users, eq(s.users.id, s.auditLog.userId))
    .where(sql.join(where, sql` and `))
    .orderBy(sql`${s.auditLog.at} desc, ${s.auditLog.id} desc`)
    .limit(opts.limit ?? 1000);
}

/** حركة المخزون لكل صنف في الفترة: الافتتاحي والوارد والصادر والختامي كمية وقيمة (متوسط مرجّح من حركات المخزون). */
export async function stockMovement(db: Db, opts: { from: string; to: string; warehouseId?: number | null }) {
  const wh = opts.warehouseId ? sql`and m.warehouse_id = ${opts.warehouseId}` : sql``;
  const r = await rows<{ id: number; code: string; name: string; unit: string | null; oq: string; ov: string; iq: string; iv: string; xq: string; xv: string }>(
    db,
    sql`select p.id, p.code, p.name_ar as name, p.unit,
          coalesce(sum(m.quantity) filter (where m.move_date < ${opts.from}), 0) as oq,
          coalesce(sum(m.value) filter (where m.move_date < ${opts.from}), 0) as ov,
          coalesce(sum(m.quantity) filter (where m.move_date >= ${opts.from} and m.quantity > 0), 0) as iq,
          coalesce(sum(m.value) filter (where m.move_date >= ${opts.from} and m.quantity > 0), 0) as iv,
          coalesce(sum(-m.quantity) filter (where m.move_date >= ${opts.from} and m.quantity < 0), 0) as xq,
          coalesce(sum(-m.value) filter (where m.move_date >= ${opts.from} and m.quantity < 0), 0) as xv
        from stock_moves m join products p on p.id = m.product_id
        where m.move_date <= ${opts.to} ${wh}
        group by p.id order by p.code`,
  );
  const q3 = (v: number) => Math.round(v * 1000) / 1000 + 0;
  return r.map((x) => {
    const [oq, iq, xq] = [q3(n(x.oq)), q3(n(x.iq)), q3(n(x.xq))];
    const [ov, iv, xv] = [r2(n(x.ov)), r2(n(x.iv)), r2(n(x.xv))];
    return { id: Number(x.id), code: x.code, name: x.name, unit: x.unit, openingQty: oq, openingValue: ov, inQty: iq, inValue: iv, outQty: xq, outValue: xv, closingQty: q3(oq + iq - xq), closingValue: r2(ov + iv - xv) };
  });
}

// ───────────── ربحية المركبات والسائقين (الخطوة 5) ─────────────

export type FleetBy = "vehicle" | "driver";

/**
 * ربحية المركبات أو السائقين من القيود المرحّلة (قرارات أحمد 6 و7 و8، 2026-11-21):
 * - المركبة: كل سطر إيراد أو مصروف على مركز تكلفتها.
 * - السائق: السائق المسجل على السطر (المستند، ومنه الرواتب والعمولة من المسير)، ثم سائق الشحنة المرتبطة،
 *   ثم السائق المسند لمركبة السطر في تاريخ القيد.
 * الإيراد 4xxx، وكل حساب تكلفة مباشرة 5xxx عمود مستقل، وما سواها (6xxx و7xxx) «مصاريف أخرى» بتفاصيل حساباتها.
 * ما لا يُنسب لسائق يُجمع في سطر «دون سائق» حتى تتطابق المجاميع.
 */
export async function fleetProfitability(db: Db, opts: { from: string; to: string; by: FleetBy; id?: number | null }) {
  const driverOf = sql`coalesce(l.driver_id, w.driver_id,
      (select va.driver_id from vehicle_assignments va
        where va.vehicle_id = v.id and va.from_date <= e.entry_date and (va.to_date is null or va.to_date >= e.entry_date)
        order by va.from_date desc limit 1))`;
  const key = opts.by === "vehicle" ? sql`v.id` : driverOf;
  const lines = await rows<{ k: number | null; account_id: number; code: string; account: string; amount: string }>(
    db,
    sql`select ${key} as k, a.id as account_id, a.code, a.name_ar as account,
          sum(case when a.code like '4%' then l.credit_base - l.debit_base else l.debit_base - l.credit_base end) as amount
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
        join accounts a on a.id = l.account_id
        left join vehicles v on v.cost_center_id = l.cost_center_id
        left join waybills w on w.id = l.waybill_id
        where e.entry_date between ${opts.from} and ${opts.to} and left(a.code, 1) in ('4', '5', '6', '7')
          ${opts.by === "vehicle" ? sql`and v.id is not null` : sql`and (v.id is not null or l.driver_id is not null or w.driver_id is not null)`}
        group by 1, a.id, a.code, a.name_ar`,
  );
  const tripCol = opts.by === "vehicle" ? sql`w.vehicle_id` : sql`w.driver_id`;
  const trips = await rows<{ k: number; trips: number; route: string | null; customer: string | null }>(
    db,
    sql`select ${tripCol} as k, count(*)::int as trips, fl.name_ar || ' ← ' || tl.name_ar as route, p.name_ar as customer
        from waybills w
        join routes r on r.id = w.route_id join locations fl on fl.id = r.from_location_id join locations tl on tl.id = r.to_location_id
        join parties p on p.id = w.customer_id
        where w.status not in ('draft', 'rejected') and w.waybill_date between ${opts.from} and ${opts.to} and ${tripCol} is not null
        group by 1, 3, 4`,
  );
  const names = new Map<number, string>(
    (opts.by === "vehicle"
      ? await db.select({ id: s.vehicles.id, name: s.vehicles.plate }).from(s.vehicles)
      : await db.select({ id: s.drivers.id, name: s.employees.nameAr }).from(s.drivers).innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    ).map((r) => [r.id, r.name]),
  );

  type Row = { id: number | null; name: string; trips: number; revenue: number; direct: Record<string, number>; directTotal: number; other: { code: string; account: string; amount: number }[]; otherTotal: number; profit: number; margin: number | null; routes: { name: string; trips: number }[]; customers: { name: string; trips: number }[] };
  const map = new Map<number | null, Row>();
  const get = (k: number | null) => {
    let r = map.get(k);
    if (!r) {
      r = { id: k, name: k == null ? "دون سائق" : (names.get(k) ?? `#${k}`), trips: 0, revenue: 0, direct: {}, directTotal: 0, other: [], otherTotal: 0, profit: 0, margin: null, routes: [], customers: [] };
      map.set(k, r);
    }
    return r;
  };
  const directAccounts = new Map<string, string>();
  for (const l of lines) {
    const amount = n(l.amount);
    if (Math.abs(amount) < 0.005) continue;
    const r = get(l.k == null ? null : Number(l.k));
    if (l.code.startsWith("4")) r.revenue += amount;
    else if (l.code.startsWith("5")) {
      r.direct[l.code] = (r.direct[l.code] ?? 0) + amount;
      directAccounts.set(l.code, l.account);
    } else r.other.push({ code: l.code, account: l.account, amount: r2(amount) });
  }
  const add = (list: { name: string; trips: number }[], name: string | null, count: number) => {
    if (!name) return;
    const x = list.find((i) => i.name === name);
    if (x) x.trips += count;
    else list.push({ name, trips: count });
  };
  for (const t of trips) {
    const r = get(Number(t.k));
    r.trips += Number(t.trips);
    add(r.routes, t.route, Number(t.trips));
    add(r.customers, t.customer, Number(t.trips));
  }
  let result = [...map.values()].map((r) => {
    for (const c of Object.keys(r.direct)) r.direct[c] = r2(r.direct[c]);
    const revenue = r2(r.revenue);
    const directTotal = r2(Object.values(r.direct).reduce((a, b) => a + b, 0));
    const otherTotal = r2(r.other.reduce((a, b) => a + b.amount, 0));
    const profit = r2(revenue - directTotal - otherTotal);
    return {
      ...r,
      revenue,
      directTotal,
      otherTotal,
      profit,
      margin: revenue ? r2((profit / revenue) * 100) : null,
      other: r.other.sort((a, b) => a.code.localeCompare(b.code)),
      routes: r.routes.sort((a, b) => b.trips - a.trips),
      customers: r.customers.sort((a, b) => b.trips - a.trips),
    };
  });
  result = result.filter((r) => r.revenue || r.directTotal || r.otherTotal || r.trips);
  if (opts.id) result = result.filter((r) => r.id === opts.id);
  // الأعمدة: حسابات 5xxx التي فيها أرقام في النتيجة المعروضة فقط
  const used = new Set(result.flatMap((r) => Object.keys(r.direct).filter((c) => r.direct[c])));
  const columns = [...directAccounts].filter(([code]) => used.has(code)).sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => ({ code, name }));
  result.sort((a, b) => (a.id == null ? 1 : b.id == null ? -1 : b.profit - a.profit));
  return { columns, rows: result };
}
