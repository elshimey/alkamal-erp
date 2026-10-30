import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { PLAN_ALERT_DAYS } from "@/data/maintenance";
import { expiryCounts, type OwnerKind } from "@/lib/documents";

// مؤشرات اللوحة الرئيسية. الأرقام المالية من القيود المرحّلة فقط (بالريال)،
// وأرقام التشغيل من الشحنات نفسها.

export type PeriodKey = "week" | "month" | "quarter" | "year" | "custom";
export const PERIODS: Record<Exclude<PeriodKey, "custom">, string> = {
  week: "هذا الأسبوع",
  month: "هذا الشهر",
  quarter: "هذا الربع",
  year: "هذه السنة",
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));
const DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** بداية ونهاية الفترة الحالية والفترة المماثلة السابقة لها (حتى نفس اليوم للمقارنة العادلة). */
export function periodRange(key: Exclude<PeriodKey, "custom">, today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const mi = m - 1;
  if (key === "week") {
    // الأسبوع يبدأ الأحد كما في السعودية، ويُقارن بنفس الأيام من الأسبوع الماضي
    const t = utc(y, mi, d);
    const from = new Date(t.getTime() - t.getUTCDay() * DAY);
    return {
      from: iso(from),
      to: today,
      prevFrom: iso(new Date(from.getTime() - 7 * DAY)),
      prevTo: iso(new Date(t.getTime() - 7 * DAY)),
    };
  }
  const startMonth = key === "month" ? mi : key === "quarter" ? mi - (mi % 3) : 0;
  const span = key === "month" ? 1 : key === "quarter" ? 3 : 12;
  const from = utc(y, startMonth);
  const prevFrom = utc(y, startMonth - span);
  // نفس عدد الأيام المنقضية في الفترة السابقة
  const elapsed = (utc(y, mi, d).getTime() - from.getTime()) / DAY;
  const prevEndCap = new Date(utc(y, startMonth).getTime() - DAY);
  const prevTo = new Date(Math.min(prevFrom.getTime() + elapsed * DAY, prevEndCap.getTime()));
  return {
    from: iso(from),
    to: today,
    prevFrom: iso(prevFrom),
    prevTo: iso(prevTo),
  };
}

/** الفترة المختارة من رابط اللوحة: جاهزة (أسبوع/شهر/ربع/سنة) أو مخصصة من تاريخ إلى تاريخ. */
export function resolvePeriod(sp: { p?: string; from?: string; to?: string }, today: string) {
  const valid = (v?: string) => (v && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
  const f = valid(sp.from);
  const t = valid(sp.to);
  if (sp.p === "custom" && (f || t)) {
    let from = f ?? t!;
    let to = t ?? today;
    if (from > to) [from, to] = [to, from];
    const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
    const prevTo = new Date(Date.parse(from) - DAY);
    return {
      key: "custom" as PeriodKey,
      label: `${from} ← ${to}`,
      from,
      to,
      prevFrom: iso(new Date(prevTo.getTime() - (days - 1) * DAY)),
      prevTo: iso(prevTo),
    };
  }
  const key = sp.p === "week" || sp.p === "quarter" || sp.p === "year" ? sp.p : "month";
  return {
    key: key as PeriodKey,
    label: PERIODS[key],
    ...periodRange(key, today),
  };
}

export type Period = ReturnType<typeof resolvePeriod>;

type Row = Record<string, unknown>;
const rows = async <T extends Row>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100 + 0; // + 0 يحوّل -0 إلى 0

/** صافي كل حساب تفصيلي (أول 4 أرقام) في قائمة الدخل خلال فترة: موجب = إيراد، سالب = تكلفة. */
async function incomeByAccount(db: Db, from: string, to: string) {
  const r = await rows<{ code: string; name: string; net: string }>(
    db,
    sql`select left(a.code, 4) as code, min(p.name_ar) as name, sum(l.credit_base - l.debit_base) as net
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
        join accounts a on a.id = l.account_id
        left join accounts p on p.code = left(a.code, 4)
        where e.entry_date between ${from} and ${to} and left(a.code, 1) in ('4', '5', '6')
        group by left(a.code, 4)`,
  );
  return r.map((x) => ({ code: x.code, name: x.name, net: n(x.net) }));
}

function summarize(lines: { code: string; net: number }[]) {
  const sum = (p: string) => lines.filter((l) => l.code.startsWith(p)).reduce((a, l) => a + l.net, 0);
  const revenue = sum("4");
  const directCost = -sum("5");
  const admin = -sum("6");
  return {
    revenue: r2(revenue),
    directCost: r2(directCost),
    gross: r2(revenue - directCost),
    admin: r2(admin),
    net: r2(revenue - directCost - admin),
  };
}

// تجميع تكاليف التشغيل في بنود يفهمها المدير
const COST_GROUPS: { key: string; label: string; codes: string[] }[] = [
  { key: "fuel", label: "الديزل", codes: ["5101"] },
  {
    key: "commission",
    label: "عمولات السائقين والمناديب",
    codes: ["5102", "5114"],
  },
  { key: "salaries", label: "رواتب السائقين", codes: ["5103"] },
  {
    key: "trip",
    label: "مصاريف الرحلات والحدود",
    codes: ["5104", "5106", "5112", "5113"],
  },
  { key: "carriers", label: "الناقلون الخارجيون", codes: ["5105"] },
  { key: "maintenance", label: "الصيانة والإطارات", codes: ["5107", "5108"] },
  { key: "fixed", label: "التأمين والإهلاك", codes: ["5109", "5110", "5111"] },
];

export async function financials(db: Db, range: { from: string; to: string; prevFrom: string; prevTo: string }) {
  const [cur, prev] = await Promise.all([incomeByAccount(db, range.from, range.to), incomeByAccount(db, range.prevFrom, range.prevTo)]);
  const costs = COST_GROUPS.map((g) => ({
    ...g,
    amount: r2(-cur.filter((l) => g.codes.includes(l.code)).reduce((a, l) => a + l.net, 0)),
  }));
  const known = new Set(COST_GROUPS.flatMap((g) => g.codes));
  const other = -cur.filter((l) => l.code.startsWith("5") && !known.has(l.code)).reduce((a, l) => a + l.net, 0);
  if (Math.abs(other) > 0.005)
    costs.push({
      key: "other",
      label: "تكاليف أخرى",
      codes: [],
      amount: other,
    });
  const revenue = [
    {
      label: "النقل الداخلي",
      amount: cur.find((l) => l.code === "4101")?.net ?? 0,
    },
    {
      label: "النقل الدولي",
      amount: cur.find((l) => l.code === "4102")?.net ?? 0,
    },
    {
      label: "رسوم ومصاريف مستردة",
      amount: cur.filter((l) => ["4103", "4104", "4105"].includes(l.code)).reduce((a, l) => a + l.net, 0),
    },
    {
      label: "إيرادات أخرى",
      amount: cur.filter((l) => l.code.startsWith("42")).reduce((a, l) => a + l.net, 0),
    },
  ];
  return {
    current: summarize(cur),
    previous: summarize(prev),
    costs: costs.filter((c) => Math.abs(c.amount) > 0.005),
    revenue,
  };
}

/** الإيراد والتكلفة لآخر 6 أشهر. */
export async function monthlyTrend(db: Db, today: string) {
  const [y, m] = today.split("-").map(Number);
  const from = iso(utc(y, m - 6));
  const r = await rows<{ month: string; revenue: string; cost: string }>(
    db,
    sql`select to_char(e.entry_date, 'YYYY-MM') as month,
          sum(case when a.code like '4%' then l.credit_base - l.debit_base else 0 end) as revenue,
          sum(case when a.code like '5%' or a.code like '6%' then l.debit_base - l.credit_base else 0 end) as cost
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
        join accounts a on a.id = l.account_id
        where e.entry_date >= ${from} and e.entry_date <= ${today}
        group by 1`,
  );
  return Array.from({ length: 6 }, (_, i) => {
    const key = iso(utc(y, m - 6 + i)).slice(0, 7);
    const hit = r.find((x) => x.month === key);
    return { month: key, revenue: n(hit?.revenue), cost: n(hit?.cost) };
  });
}

/** أرصدة تراكمية حتى اليوم: النقدية، العملاء، الموردون، وصافي الضريبة. */
export async function balances(db: Db, today: string) {
  const [r] = await rows<Record<string, string>>(
    db,
    sql`select
          coalesce(sum(case when a.code like '1101%' or a.code like '1102%' then l.debit_base - l.credit_base end), 0) as cash,
          coalesce(sum(case when a.code like '1103%' then l.debit_base - l.credit_base end), 0) as receivable,
          coalesce(sum(case when a.code like '1105%' then l.debit_base - l.credit_base end), 0) as custody,
          coalesce(sum(case when a.code like '2101%' or a.code like '2102%' or a.code like '2103%' or a.code like '2104%' or a.code like '2105%' then l.credit_base - l.debit_base end), 0) as payable,
          coalesce(sum(case when a.code like '2109%' or a.code like '2110%' then l.credit_base - l.debit_base when a.code like '1108%' then l.credit_base - l.debit_base end), 0) as vat
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
        join accounts a on a.id = l.account_id
        where e.entry_date <= ${today}`,
  );
  return {
    cash: n(r.cash),
    receivable: n(r.receivable),
    custody: n(r.custody),
    payable: n(r.payable),
    vat: n(r.vat),
  };
}

/** أعمار الذمم من الفواتير المصدرة غير المسددة (بالريال). */
export async function receivablesAging(db: Db, today: string) {
  const [r] = await rows<Record<string, string>>(
    db,
    sql`select
          count(*) filter (where due_date < ${today})::int as overdue_count,
          coalesce(sum(o) filter (where due_date >= ${today}), 0) as not_due,
          coalesce(sum(o) filter (where due_date < ${today} and ${today}::date - due_date <= 30), 0) as d30,
          coalesce(sum(o) filter (where ${today}::date - due_date between 31 and 60), 0) as d60,
          coalesce(sum(o) filter (where ${today}::date - due_date > 60), 0) as d90
        from (select due_date, (total - paid_amount) * exchange_rate as o from sales_invoices
              where status = 'issued' and paid_amount < total) x`,
  );
  return {
    overdueCount: n(r.overdue_count),
    notDue: n(r.not_due),
    d30: n(r.d30),
    d60: n(r.d60),
    d90: n(r.d90),
  };
}

export async function collected(db: Db, from: string, to: string) {
  const [r] = await rows<{ total: string; count: number }>(
    db,
    sql`select coalesce(sum(amount * exchange_rate), 0) as total, count(*)::int as count
        from receipts where status = 'posted' and receipt_date between ${from} and ${to}`,
  );
  return { total: n(r.total), count: n(r.count) };
}

// سعر الريال لعملة الشحنة في تاريخها (آخر سعر مسجّل)
const sarRate = sql`(case when w.currency_code = 'SAR' then 1 else coalesce((select er.rate from exchange_rates er
  where er.currency_code = w.currency_code and er.rate_date <= w.waybill_date order by er.rate_date desc limit 1), 0) end)`;

/** قيمة الرحلات المنفذة التي لم تصدر فاتورتها بعد (مسلّمة أو معتمدة). */
export async function unbilledTrips(db: Db) {
  const [r] = await rows<{ value: string; count: number }>(db, sql`select coalesce(sum(w.amount * ${sarRate}), 0) as value, count(*)::int as count from waybills w where w.status in ('delivered', 'approved')`);
  return { value: n(r.value), count: n(r.count) };
}

/** الرحلات في الفترة: حسب الحالة، والدولية، والكيلومترات، والديزل. */
export async function operations(db: Db, from: string, to: string, ownDriverUserId?: number) {
  const own = ownDriverUserId ? sql`and w.driver_id in (select id from drivers where user_id = ${ownDriverUserId})` : sql``;
  const [byStatus, [totals], [fuel]] = await Promise.all([
    rows<{ status: string; n: number }>(db, sql`select w.status, count(*)::int as n from waybills w where w.waybill_date between ${from} and ${to} ${own} group by w.status`),
    rows<Record<string, string>>(
      db,
      sql`select count(*)::int as trips,
            count(*) filter (where r.is_international)::int as international,
            count(*) filter (where w.carrier_id is not null)::int as carrier,
            coalesce(sum(r.distance_km), 0) as km,
            coalesce(sum(w.weight_tons), 0) as tons,
            count(distinct w.customer_id)::int as customers,
            coalesce(sum(w.amount * ${sarRate}), 0) as value
          from waybills w join routes r on r.id = w.route_id
          where w.waybill_date between ${from} and ${to} and w.status <> 'rejected' ${own}`,
    ),
    rows<Record<string, string>>(
      db,
      sql`select coalesce(sum(f.liters), 0) as liters, coalesce(sum(f.amount * f.exchange_rate), 0) as cost
          from waybill_fuel f join waybills w on w.id = f.waybill_id
          where w.waybill_date between ${from} and ${to} and w.status <> 'rejected' ${own}`,
    ),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b.n])) as Record<string, number>,
    trips: n(totals.trips),
    international: n(totals.international),
    carrier: n(totals.carrier),
    km: n(totals.km),
    tons: n(totals.tons),
    customers: n(totals.customers),
    value: n(totals.value),
    liters: n(fuel.liters),
    fuelCost: n(fuel.cost),
  };
}

/** ربحية كل مركبة (مركز تكلفتها) من القيود المرحّلة في الفترة، مع عدد رحلاتها. */
export async function vehicleProfit(db: Db, from: string, to: string) {
  const r = await rows<Record<string, string>>(
    db,
    sql`select cc.id as cc_id, cc.code, cc.name_ar, v.id as vehicle_id, v.plate,
          coalesce(sum(case when a.code like '4%' then l.credit_base - l.debit_base end), 0) as revenue,
          coalesce(sum(case when a.code like '5%' then l.debit_base - l.credit_base end), 0) as cost,
          coalesce(sum(case when a.code like '5101%' then l.debit_base - l.credit_base end), 0) as fuel,
          (select count(*) from waybills w
            where (w.vehicle_id = v.id or (v.id is null and cc.code = 'EXT' and w.carrier_id is not null))
              and w.status <> 'rejected' and w.waybill_date between ${from} and ${to})::int as trips
        from journal_lines l
        join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
        join accounts a on a.id = l.account_id
        join cost_centers cc on cc.id = l.cost_center_id
        left join vehicles v on v.cost_center_id = cc.id
        where e.entry_date between ${from} and ${to} and left(a.code, 1) in ('4', '5')
        group by cc.id, cc.code, cc.name_ar, v.id, v.plate`,
  );
  return r
    .map((x) => {
      const revenue = n(x.revenue);
      const cost = n(x.cost);
      return {
        id: n(x.cc_id),
        vehicleId: x.vehicle_id ? n(x.vehicle_id) : null,
        name: x.plate ?? x.name_ar,
        revenue,
        cost,
        fuel: n(x.fuel),
        trips: n(x.trips),
        profit: revenue - cost,
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

export async function fleetStatus(db: Db) {
  const [r] = await rows<Record<string, string>>(
    db,
    sql`select
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where status = 'maintenance')::int as maintenance,
          count(*) filter (where status = 'stopped')::int as stopped,
          count(*) filter (where status <> 'sold')::int as total,
          (select count(distinct vehicle_id) from waybills where status = 'in_transit' and vehicle_id is not null)::int as on_trip,
          (select count(*) from vehicle_assignments where to_date is null)::int as assigned,
          (select count(*) from drivers where status = 'active')::int as drivers,
          (select count(*) from drivers d where d.status = 'active' and not exists (select 1 from vehicle_assignments va where va.driver_id = d.id and va.to_date is null))::int as idle_drivers
        from vehicles`,
  );
  return {
    active: n(r.active),
    maintenance: n(r.maintenance),
    stopped: n(r.stopped),
    total: n(r.total),
    onTrip: n(r.on_trip),
    assigned: n(r.assigned),
    drivers: n(r.drivers),
    idleDrivers: n(r.idle_drivers),
  };
}

export async function topCustomers(db: Db, from: string, to: string) {
  const r = await rows<Record<string, string>>(
    db,
    sql`select p.id, p.name_ar, sum(i.subtotal * i.exchange_rate) as revenue, count(*)::int as invoices,
          coalesce(sum((i.total - i.paid_amount) * i.exchange_rate), 0) as outstanding
        from sales_invoices i join parties p on p.id = i.customer_id
        where i.status = 'issued' and i.invoice_date between ${from} and ${to}
        group by p.id, p.name_ar order by revenue desc limit 5`,
  );
  return r.map((x) => ({
    id: n(x.id),
    name: x.name_ar,
    revenue: n(x.revenue),
    invoices: n(x.invoices),
    outstanding: n(x.outstanding),
  }));
}

/** ما يحتاج تدخلاً الآن، مرتباً بالأهمية. */
export async function alertCounts(db: Db, today: string, docKinds?: OwnerKind[]) {
  const docs = docKinds?.length ? await expiryCounts(db, today, docKinds) : { expired: 0, soon: 0, critical: [] };
  const [r] = await rows<Record<string, string>>(
    db,
    sql`select
          (select count(*) from waybills where status = 'delivered')::int as to_approve,
          (select count(*) from waybills where status = 'approved')::int as to_invoice,
          (select count(*) from waybills where status = 'in_transit' and waybill_date < ${today}::date - 7)::int as long_transit,
          (select count(*) from waybills where status = 'draft' and waybill_date < ${today}::date - 2)::int as stale_drafts,
          (select count(*) from sales_invoices where status = 'draft')::int as draft_invoices,
          (select count(*) from sales_invoices where status = 'issued' and paid_amount < total and due_date < ${today})::int as overdue,
          (select count(*) from receipts where status = 'draft')::int as draft_receipts,
          (select max(rate_date) from exchange_rates where currency_code = 'KWD') as kwd_rate_date,
          (select count(*) from vehicles where status = 'active' and not exists (select 1 from vehicle_assignments va where va.vehicle_id = vehicles.id and va.to_date is null))::int as unassigned,
          (select count(*) from expenses where status = 'pending')::int as pending_expenses,
          (select count(*) from expenses where status = 'pending' and driver_kind in ('maintenance', 'tires'))::int as pending_driver_maintenance,
          (select count(*) from purchase_invoices where status = 'draft')::int as draft_purchases,
          (select count(*) from purchase_invoices where status = 'posted' and paid_amount < total and due_date < ${today})::int as overdue_purchases,
          (select coalesce(sum((total - paid_amount) * exchange_rate), 0) from purchase_invoices
            where status = 'posted' and paid_amount < total and due_date between ${today} and ${today}::date + 7) as due_week,
          (select count(*) from drivers d where d.status = 'active' and (select coalesce(sum(l.debit_base - l.credit_base), 0) from journal_lines l
            join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close' where l.account_id = d.custody_account_id) < 0)::int as negative_custody,
          (select count(*) from breakdown_requests where status in ('pending_supervisor', 'pending_approval'))::int as pending_breakdowns,
          (select count(*) from breakdown_requests where status = 'approved')::int as approved_breakdowns,
          (select count(*) from maintenance_orders where status = 'approved')::int as open_maintenance,
          (select count(*) from maintenance_orders where status = 'draft')::int as draft_maintenance,
          (select count(*) from maintenance_plans where is_active
            and coalesce(last_done_date + interval_days, ${today}::date) <= ${today}::date + ${PLAN_ALERT_DAYS}::int)::int as plans_due,
          (select count(*) from payroll_runs where status = 'draft')::int as draft_payroll,
          (select count(*) from payroll_runs where status = 'approved')::int as unpaid_payroll,
          (select count(*) from employee_advances where status = 'pending')::int as pending_advances,
          (select count(*) from traffic_violations where status = 'posted')::int as unpaid_violations,
          (select count(*) from document_submissions where status = 'pending')::int as pending_doc_uploads,
          (select count(*) from payroll_runs where month = date_trunc('month', ${today}::date - interval '1 month')::date)::int as last_month_run`,
  );
  return {
    toApprove: n(r.to_approve),
    toInvoice: n(r.to_invoice),
    longTransit: n(r.long_transit),
    staleDrafts: n(r.stale_drafts),
    draftInvoices: n(r.draft_invoices),
    overdue: n(r.overdue),
    draftReceipts: n(r.draft_receipts),
    docsExpired: docs.expired,
    docsExpiring: docs.soon,
    docsCritical: docs.critical,
    pendingDocUploads: n(r.pending_doc_uploads),
    kwdRateDate: (r.kwd_rate_date as string | null) ?? null,
    unassigned: n(r.unassigned),
    pendingExpenses: n(r.pending_expenses),
    pendingDriverMaintenance: n(r.pending_driver_maintenance),
    draftPurchases: n(r.draft_purchases),
    overduePurchases: n(r.overdue_purchases),
    dueWeek: n(r.due_week),
    negativeCustody: n(r.negative_custody),
    pendingBreakdowns: n(r.pending_breakdowns),
    approvedBreakdowns: n(r.approved_breakdowns),
    openMaintenance: n(r.open_maintenance),
    draftMaintenance: n(r.draft_maintenance),
    plansDue: n(r.plans_due),
    draftPayroll: n(r.draft_payroll),
    unpaidPayroll: n(r.unpaid_payroll),
    pendingAdvances: n(r.pending_advances),
    unpaidViolations: n(r.unpaid_violations),
    lastMonthRunMissing: n(r.last_month_run) === 0,
  };
}

// ───────────── التدفق النقدي ─────────────

const CASH = sql.raw("(a.code like '1101%' or a.code like '1102%')");

export const CASH_SECTIONS = {
  operating: "الأنشطة التشغيلية",
  investing: "الأنشطة الاستثمارية",
  financing: "الأنشطة التمويلية",
} as const;
type CashSection = keyof typeof CASH_SECTIONS;

/** يصنّف الحساب المقابل للنقدية في القيد إلى بند تدفق نقدي (IAS 7). */
function cashCategory(code: string): {
  key: string;
  label: string;
  section: CashSection;
  href?: string;
} {
  const c4 = code.slice(0, 4);
  const is = (...codes: string[]) => codes.includes(c4);
  if (is("1103", "2112") || code.startsWith("4"))
    return {
      key: "customers",
      label: "التحصيل من العملاء",
      section: "operating",
      href: "/receipts",
    };
  if (is("2101", "2102", "2103", "2104", "2105", "1111", "1110"))
    return {
      key: "suppliers",
      label: "الموردون والناقلون والورش",
      section: "operating",
      href: "/payments",
    };
  if (is("2107", "2115", "1107", "2203"))
    return {
      key: "payroll",
      label: "الرواتب والسلف",
      section: "operating",
      href: "/payroll",
    };
  if (is("1105", "1106"))
    return {
      key: "custody",
      label: "عهد السائقين وبطاقات الوقود",
      section: "operating",
      href: "/expenses",
    };
  if (is("1108", "2109", "2110", "2111"))
    return {
      key: "tax",
      label: "الضريبة والزكاة",
      section: "operating",
      href: "/reports/vat",
    };
  if (is("2108"))
    return {
      key: "violations",
      label: "المخالفات المرورية",
      section: "operating",
      href: "/violations",
    };
  if (code.startsWith("5") || code.startsWith("6") || code.startsWith("7") || is("1109", "2106"))
    return {
      key: "expenses",
      label: "مصروفات مدفوعة مباشرة",
      section: "operating",
      href: "/expenses",
    };
  if (code.startsWith("12"))
    return {
      key: "assets",
      label: "شراء وبيع الأصول الثابتة",
      section: "investing",
      href: "/fixed-assets",
    };
  if (is("2113", "2114", "2201", "2202"))
    return {
      key: "loans",
      label: "القروض وعقود الإيجار",
      section: "financing",
    };
  if (code.startsWith("31")) return { key: "owners", label: "الشركاء ورأس المال", section: "financing" };
  return {
    key: "other",
    label: "حركات أخرى",
    section: "operating",
    href: "/journal",
  };
}

/**
 * التدفق النقدي للفترة من القيود المرحّلة: كل قيد يمس الصناديق أو البنوك يُصنَّف بحساباته المقابلة،
 * فالطرف الدائن المقابل داخل للنقدية والمدين خارج منها. التحويل بين الصناديق والبنوك لا يظهر لأنه لا يغيّر الرصيد.
 */
export async function cashFlow(db: Db, from: string, to: string) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  const bucket = sql.raw(days <= 35 ? "'YYYY-MM-DD'" : "'YYYY-MM'");
  const [counter, accounts, series] = await Promise.all([
    rows<{ code: string; cash_in: string; cash_out: string }>(
      db,
      sql`select a.code, sum(greatest(l.credit_base - l.debit_base, 0)) as cash_in, sum(greatest(l.debit_base - l.credit_base, 0)) as cash_out
          from journal_lines l
          join accounts a on a.id = l.account_id
          where not ${CASH} and l.entry_id in (
            select l.entry_id from journal_lines l
            join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
            join accounts a on a.id = l.account_id
            where e.entry_date between ${from} and ${to} and ${CASH})
          group by a.code`,
    ),
    rows<{
      id: number;
      code: string;
      name: string;
      opening: string;
      cash_in: string;
      cash_out: string;
    }>(
      db,
      sql`select a.id, a.code, a.name_ar as name,
            coalesce(sum(l.debit_base - l.credit_base) filter (where e.entry_date < ${from}), 0) as opening,
            coalesce(sum(l.debit_base) filter (where e.entry_date between ${from} and ${to}), 0) as cash_in,
            coalesce(sum(l.credit_base) filter (where e.entry_date between ${from} and ${to}), 0) as cash_out
          from journal_lines l
          join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
          join accounts a on a.id = l.account_id
          where ${CASH} and e.entry_date <= ${to}
          group by a.id, a.code, a.name_ar
          order by a.code`,
    ),
    rows<{ k: string; cash_in: string; cash_out: string }>(
      db,
      sql`select to_char(e.entry_date, ${bucket}) as k,
            sum(greatest(l.debit_base - l.credit_base, 0)) as cash_in, sum(greatest(l.credit_base - l.debit_base, 0)) as cash_out
          from journal_lines l
          join journal_entries e on e.id = l.entry_id and e.status = 'posted' and e.source_type is distinct from 'year_close'
          join accounts a on a.id = l.account_id
          where ${CASH} and e.entry_date between ${from} and ${to}
            and exists (select 1 from journal_lines x join accounts xa on xa.id = x.account_id
                        where x.entry_id = e.id and not (xa.code like '1101%' or xa.code like '1102%'))
          group by 1 order by 1`,
    ),
  ]);

  const groups = new Map<
    string,
    {
      key: string;
      label: string;
      section: CashSection;
      href?: string;
      in: number;
      out: number;
    }
  >();
  for (const r of counter) {
    const cat = cashCategory(r.code);
    const g = groups.get(cat.key) ?? { ...cat, in: 0, out: 0 };
    g.in += n(r.cash_in);
    g.out += n(r.cash_out);
    groups.set(cat.key, g);
  }
  const lines = [...groups.values()].map((g) => ({ ...g, in: r2(g.in), out: r2(g.out), net: r2(g.in - g.out) })).filter((g) => g.in || g.out);
  const sections = (Object.keys(CASH_SECTIONS) as CashSection[]).map((k) => {
    const items = lines.filter((l) => l.section === k).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    return {
      key: k,
      label: CASH_SECTIONS[k],
      items,
      net: r2(items.reduce((t, l) => t + l.net, 0)),
    };
  });
  const accts = accounts.map((a) => {
    const opening = n(a.opening);
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      opening: r2(opening),
      in: r2(n(a.cash_in)),
      out: r2(n(a.cash_out)),
      closing: r2(opening + n(a.cash_in) - n(a.cash_out)),
    };
  });
  const opening = r2(accts.reduce((t, a) => t + a.opening, 0));
  const closing = r2(accts.reduce((t, a) => t + a.closing, 0));
  const inflow = r2(lines.reduce((t, l) => t + l.in, 0));
  const outflow = r2(lines.reduce((t, l) => t + l.out, 0));
  return {
    opening,
    closing,
    inflow,
    outflow,
    net: r2(closing - opening),
    sections,
    accounts: accts,
    series: series.map((s) => ({
      key: s.k,
      in: n(s.cash_in),
      out: n(s.cash_out),
    })),
    daily: days <= 35,
  };
}
