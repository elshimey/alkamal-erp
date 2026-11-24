import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { PAGE_SIZE } from "@/lib/paging";

/**
 * «مصدر الرقم» (طلب أحمد 2026-11-24): كل رقم في لوحة القيادة والتقارير رابط يفتح القيود التي حُسب منها
 * بنفس الشروط (الفترة، الحسابات، مركز التكلفة أو المركبة، الجهة، السائق، نوع الضريبة، نوع المستند)،
 * ومجموعها يُقارن بالرقم المنقور. والرقم الذي لا يأتي من القيود (الفواتير المفتوحة، خانات مبيعات الإقرار، المخزون)
 * يفتح المستندات التي حُسب منها بالطريقة نفسها (`doc`).
 */

export type SourceMode = "net" | "bal";
export type SourceDoc = "open" | "inv" | "vat_sales" | "vat_pzero" | "stock";

export interface SourceFilter {
  title: string;
  from?: string;
  to: string;
  /** بادئات أكواد الحسابات؛ «=1103» تعني الحساب نفسه فقط. */
  codes?: string[];
  /** 0 = أي سطر عليه مركز تكلفة. */
  costCenterId?: number;
  vehicleId?: number;
  /** نطاق تقرير الربحية لمجاميعه: v = سطور على مركز تكلفة مركبة، d = سطور يُعرف لها سائق أو مركبة. */
  fleet?: "v" | "d";
  /** 0 = أي سطر مربوط بجهة. */
  partyId?: number;
  /** السائق كما في تقرير الربحية: سائق السطر، ثم سائق الشحنة، ثم المسند للمركبة في تاريخ القيد. 0 = دون سائق. */
  driverId?: number;
  /** نوع الضريبة بسلوكه («يتصرف مثل»)؛ pur_standard يشمل السطر دون نوع كما في الإقرار. */
  tax?: string;
  sourceTypes?: string[];
  excludeSourceTypes?: string[];
  /** القيود التي تمس هذه الحسابات أيضاً (التدفق النقدي: الطرف المقابل للصناديق والبنوك). */
  touch?: string[];
  /** الأطراف المدينة فقط (d) أو الدائنة فقط (c). */
  side?: "d" | "c";
  /** استبعاد قيد إقفال السنة كما تفعل قائمة الدخل والربحية. */
  noClose?: boolean;
  /** net = الحركة في الفترة، bal = الرصيد في آخرها (افتتاحي + حركة). */
  mode: SourceMode;
  /** 1 = مدين موجب، ‎-1 = دائن موجب (الإيراد والالتزامات). */
  sign: 1 | -1;
  /** الرقم المنقور، لعرض المطابقة. */
  expected?: number;
  /** مصدر من المستندات لا القيود. */
  doc?: SourceDoc;
  /** doc=open: العملاء أو الموردون وشريحة أيام التأخير. */
  supplier?: boolean;
  dmin?: number;
  dmax?: number;
  /** doc=stock: الصنف والمستودع والاتجاه. doc=vat_sales: in = الفواتير فقط، out = الإشعارات (التعديلات) فقط. */
  productId?: number;
  warehouseId?: number;
  dir?: "open" | "in" | "out" | "close";
}

type Params = Record<string, string | string[] | undefined>;
const str = (sp: Params, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
const int = (sp: Params, k: string) => {
  const v = Number(str(sp, k));
  return Number.isInteger(v) && v >= 0 ? v : undefined;
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const list = (v?: string) => (v ? v.split(",").map((x) => x.trim()).filter((x) => /^=?[0-9]{1,8}$|^[a-z_]{2,40}$/.test(x)) : undefined);

/** الرابط: الرقم المنقور وشروطه في معاملات قصيرة، حتى يُشارك ويُحفظ. */
export function sourceHref(f: Partial<SourceFilter> & { title: string; to: string }) {
  const q = new URLSearchParams();
  q.set("t", f.title);
  if (f.from) q.set("from", f.from);
  q.set("to", f.to);
  if (f.codes?.length) q.set("c", f.codes.join(","));
  if (f.costCenterId != null) q.set("cc", String(f.costCenterId));
  if (f.vehicleId) q.set("veh", String(f.vehicleId));
  if (f.partyId != null) q.set("party", String(f.partyId));
  if (f.driverId != null) q.set("drv", String(f.driverId));
  if (f.fleet) q.set("fl", f.fleet);
  if (f.tax) q.set("tax", f.tax);
  if (f.sourceTypes?.length) q.set("st", f.sourceTypes.join(","));
  if (f.excludeSourceTypes?.length) q.set("xst", f.excludeSourceTypes.join(","));
  if (f.touch?.length) q.set("touch", f.touch.join(","));
  if (f.side) q.set("side", f.side);
  if (f.noClose) q.set("nc", "1");
  if (f.mode === "bal") q.set("m", "bal");
  if (f.sign === -1) q.set("s", "-1");
  if (f.expected != null && Number.isFinite(f.expected)) q.set("n", String(Math.round(f.expected * 100) / 100));
  if (f.doc) q.set("doc", f.doc);
  if (f.supplier) q.set("sup", "1");
  if (f.dmin != null) q.set("dmin", String(f.dmin));
  if (f.dmax != null) q.set("dmax", String(f.dmax));
  if (f.productId) q.set("prod", String(f.productId));
  if (f.warehouseId) q.set("wh", String(f.warehouseId));
  if (f.dir) q.set("dir", f.dir);
  return `/reports/source?${q.toString()}`;
}

export function parseSource(sp: Params, today: string): SourceFilter {
  const date = (k: string) => {
    const v = str(sp, k);
    return v && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined;
  };
  const doc = str(sp, "doc");
  const tax = str(sp, "tax");
  const side = str(sp, "side");
  const dir = str(sp, "dir");
  const expected = Number(str(sp, "n"));
  return {
    title: (str(sp, "t") ?? "مصدر الرقم").slice(0, 120),
    from: date("from"),
    to: date("to") ?? today,
    codes: list(str(sp, "c")),
    costCenterId: int(sp, "cc"),
    vehicleId: int(sp, "veh"),
    partyId: int(sp, "party"),
    driverId: int(sp, "drv"),
    fleet: str(sp, "fl") === "v" ? "v" : str(sp, "fl") === "d" ? "d" : undefined,
    tax: tax && /^[a-z_]{2,40}$/.test(tax) ? tax : undefined,
    sourceTypes: list(str(sp, "st")),
    excludeSourceTypes: list(str(sp, "xst")),
    touch: list(str(sp, "touch")),
    side: side === "d" || side === "c" ? side : undefined,
    noClose: str(sp, "nc") === "1",
    mode: str(sp, "m") === "bal" ? "bal" : "net",
    sign: str(sp, "s") === "-1" ? -1 : 1,
    expected: str(sp, "n") != null && Number.isFinite(expected) ? expected : undefined,
    doc: doc === "open" || doc === "inv" || doc === "vat_sales" || doc === "vat_pzero" || doc === "stock" ? doc : undefined,
    supplier: str(sp, "sup") === "1",
    dmin: int(sp, "dmin"),
    dmax: int(sp, "dmax"),
    productId: int(sp, "prod"),
    warehouseId: int(sp, "wh"),
    dir: dir === "open" || dir === "in" || dir === "out" || dir === "close" ? dir : undefined,
  };
}

const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
async function rows<T>(db: Db, q: SQL) {
  return (await db.execute(q)) as unknown as T[];
}
const codeMatch = (codes: string[]) => sql.join(codes.map((c) => (c.startsWith("=") ? sql`a.code = ${c.slice(1)}` : sql`a.code like ${c + "%"}`)), sql` or `);

/** نفس نسبة السائق في تقرير الربحية (`fleetProfitability`). */
const DRIVER_OF = sql`coalesce(l.driver_id, w.driver_id,
  (select va.driver_id from vehicle_assignments va
    where va.vehicle_id = v.id and va.from_date <= e.entry_date and (va.to_date is null or va.to_date >= e.entry_date)
    order by va.from_date desc limit 1))`;

/** شروط السطر عدا التاريخ. */
function lineScope(f: SourceFilter) {
  const w: SQL[] = [];
  if (f.codes?.length) w.push(sql`(${codeMatch(f.codes)})`);
  // 0 = أي مركز تكلفة (مجاميع تقرير مراكز التكلفة)
  if (f.costCenterId != null) w.push(f.costCenterId === 0 ? sql`l.cost_center_id is not null` : sql`l.cost_center_id = ${f.costCenterId}`);
  if (f.vehicleId) w.push(sql`v.id = ${f.vehicleId}`);
  // 0 = أي جهة (مجاميع أرصدة العملاء والموردين تشمل السطور المربوطة بجهة فقط)
  if (f.partyId != null) w.push(f.partyId === 0 ? sql`l.party_id is not null` : sql`l.party_id = ${f.partyId}`);
  if (f.driverId != null) {
    w.push(f.driverId === 0 ? sql`${DRIVER_OF} is null and (v.id is not null or l.driver_id is not null or w.driver_id is not null)` : sql`${DRIVER_OF} = ${f.driverId}`);
  }
  if (f.fleet === "v") w.push(sql`v.id is not null`);
  if (f.fleet === "d") w.push(sql`(v.id is not null or l.driver_id is not null or w.driver_id is not null)`);
  if (f.tax) w.push(f.tax === "pur_standard" ? sql`coalesce(nullif(t.behavior, ''), 'pur_standard') = 'pur_standard'` : sql`t.behavior = ${f.tax}`);
  if (f.sourceTypes?.length) w.push(sql`coalesce(e.source_type, 'manual') in (${sql.join(f.sourceTypes.map((x) => sql`${x}`), sql`, `)})`);
  if (f.excludeSourceTypes?.length) w.push(sql`coalesce(e.source_type, 'manual') not in (${sql.join(f.excludeSourceTypes.map((x) => sql`${x}`), sql`, `)})`);
  if (f.noClose) w.push(sql`e.source_type is distinct from 'year_close'`);
  if (f.touch?.length) w.push(sql`exists (select 1 from journal_lines x join accounts a on a.id = x.account_id where x.entry_id = e.id and x.id <> l.id and (${codeMatch(f.touch)}))`);
  if (f.side === "d") w.push(sql`l.debit_base > 0`);
  if (f.side === "c") w.push(sql`l.credit_base > 0`);
  return w.length ? sql.join(w, sql` and `) : sql`true`;
}

const FROM = sql`from journal_lines l
  join journal_entries e on e.id = l.entry_id and e.status = 'posted'
  join accounts a on a.id = l.account_id
  left join tax_codes t on t.id = l.tax_code_id
  left join vehicles v on v.cost_center_id = l.cost_center_id
  left join waybills w on w.id = l.waybill_id`;

export interface SourceLine {
  entry_id: number;
  number: string;
  entry_date: string;
  source_type: string | null;
  source_id: number | null;
  description: string | null;
  account_code: string;
  account_name: string;
  party: string | null;
  cost_center: string | null;
  debit: number;
  credit: number;
  balance: number;
}

/** قيود المصدر: الافتتاحي (للرصيد) والمجاميع على كل الصفحات، وسطور الصفحة المطلوبة برصيد متحرك. */
export async function sourceLines(db: Db, f: SourceFilter, page = 1) {
  const scope = lineScope(f);
  const from = f.from ?? "0001-01-01";
  const [open] =
    f.mode === "bal" && f.from
      ? await rows<{ v: string }>(db, sql`select coalesce(sum(l.debit_base - l.credit_base), 0) as v ${FROM} where ${scope} and e.entry_date < ${f.from}`)
      : [{ v: "0" }];
  const period = sql`e.entry_date between ${from} and ${f.to}`;
  const [tot] = await rows<{ debit: string; credit: string; count: string }>(
    db,
    sql`select coalesce(sum(l.debit_base), 0) as debit, coalesce(sum(l.credit_base), 0) as credit, count(*) as count ${FROM} where ${scope} and ${period}`,
  );
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  // الرصيد المتحرك يبدأ من مجموع ما قبل الصفحة
  const [before] = offset
    ? await rows<{ v: string }>(
        db,
        sql`select coalesce(sum(d), 0) as v from (select l.debit_base - l.credit_base as d ${FROM} where ${scope} and ${period}
              order by e.entry_date, e.id, l.line_no limit ${offset}) x`,
      )
    : [{ v: "0" }];
  const raw = await rows<Omit<SourceLine, "debit" | "credit" | "balance"> & { debit: string; credit: string }>(
    db,
    sql`select e.id as entry_id, e.number, to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, e.source_type, e.source_id,
          coalesce(l.description, e.description) as description, a.code as account_code, a.name_ar as account_name,
          p.name_ar as party, cc.name_ar as cost_center, l.debit_base as debit, l.credit_base as credit
        ${FROM}
        left join parties p on p.id = l.party_id
        left join cost_centers cc on cc.id = l.cost_center_id
        where ${scope} and ${period}
        order by e.entry_date, e.id, l.line_no
        limit ${PAGE_SIZE} offset ${offset}`,
  );
  const opening = r2(n(open.v));
  let balance = r2(opening + n(before.v));
  const lines: SourceLine[] = raw.map((l) => {
    balance = r2(balance + n(l.debit) - n(l.credit));
    return { ...l, entry_id: Number(l.entry_id), source_id: l.source_id == null ? null : Number(l.source_id), debit: n(l.debit), credit: n(l.credit), balance };
  });
  const debit = r2(n(tot.debit));
  const credit = r2(n(tot.credit));
  const net = r2(debit - credit);
  const closing = r2(opening + net);
  // الرقم بطبيعته: الحركة أو الرصيد، والدائن موجب للإيراد والالتزامات
  const value = r2(f.sign * (f.mode === "bal" ? closing : net));
  return { opening, debit, credit, net, closing, value, count: Number(tot.count), lines };
}

export interface SourceDocRow {
  date: string;
  number: string;
  href: string;
  party: string | null;
  note: string | null;
  amount: number;
}

/** المستندات التي حُسب منها رقم لا يأتي من القيود، بنفس استعلام التقرير. */
export async function sourceDocs(db: Db, f: SourceFilter): Promise<SourceDocRow[]> {
  const from = f.from ?? "0001-01-01";
  if (f.doc === "open") {
    const docs = f.supplier ? sql`purchase_invoices` : sql`sales_invoices`;
    const partyCol = f.supplier ? sql`d.supplier_id` : sql`d.customer_id`;
    const status = f.supplier ? sql`d.status = 'posted'` : sql`d.status = 'issued'`;
    const days = sql`${f.to}::date - d.due_date`;
    const w: SQL[] = [status, sql`d.paid_amount < d.total`, sql`d.invoice_date <= ${f.to}`];
    if (f.partyId) w.push(sql`${partyCol} = ${f.partyId}`);
    if (f.dmin != null) w.push(sql`${days} >= ${f.dmin}`);
    if (f.dmax != null) w.push(sql`${days} <= ${f.dmax}`);
    const r = await rows<{ id: number; number: string; date: string; due: string; party: string; amount: string; days: number }>(
      db,
      sql`select d.id, d.number, to_char(d.invoice_date, 'YYYY-MM-DD') as date, to_char(d.due_date, 'YYYY-MM-DD') as due, p.name_ar as party,
            (d.total - d.paid_amount) * d.exchange_rate as amount, (${days})::int as days
          from ${docs} d join parties p on p.id = ${partyCol}
          where ${sql.join(w, sql` and `)} order by d.due_date, d.id`,
    );
    return r.map((x) => ({
      date: x.date,
      number: x.number,
      href: f.supplier ? `/purchases/${x.id}` : `/invoices/${x.id}`,
      party: x.party,
      note: Number(x.days) > 0 ? `استحقت ${x.due}، متأخرة ${x.days} يوماً` : `تستحق ${x.due}`,
      amount: r2(n(x.amount)),
    }));
  }
  if (f.doc === "inv") {
    const w: SQL[] = [sql`i.status = 'issued'`, sql`i.invoice_date between ${from} and ${f.to}`];
    if (f.partyId) w.push(sql`i.customer_id = ${f.partyId}`);
    const r = await rows<{ id: number; number: string; date: string; party: string; amount: string }>(
      db,
      sql`select i.id, i.number, to_char(i.invoice_date, 'YYYY-MM-DD') as date, p.name_ar as party, i.subtotal * i.exchange_rate as amount
          from sales_invoices i join parties p on p.id = i.customer_id where ${sql.join(w, sql` and `)} order by i.invoice_date, i.id`,
    );
    return r.map((x) => ({ date: x.date, number: x.number, href: `/invoices/${x.id}`, party: x.party, note: "قبل الضريبة", amount: r2(n(x.amount)) }));
  }
  if (f.doc === "vat_sales") {
    // نفس استعلام خانات المبيعات في الإقرار (`vatReturn`)
    const beh = sql.raw(`case when coalesce(t.behavior, '') <> '' then t.behavior when l.vat_rate > 0 then 'standard' else 'zero' end`);
    const r = await rows<{ id: number; kind: string; number: string; date: string; party: string; amount: string }>(
      db,
      sql`select * from (
            select si.id, 'inv' as kind, si.number, to_char(si.invoice_date, 'YYYY-MM-DD') as date, p.name_ar as party, sum(l.amount * si.exchange_rate) as amount, ${beh} as b
            from sales_invoice_lines l join sales_invoices si on si.id = l.invoice_id join parties p on p.id = si.customer_id left join tax_codes t on t.id = l.tax_code_id
            where si.status <> 'draft' and si.invoice_date between ${from} and ${f.to}
            group by si.id, si.number, si.invoice_date, p.name_ar, 7
            union all
            select nt.id, nt.kind, nt.number, to_char(nt.note_date, 'YYYY-MM-DD'), p.name_ar, sum((case when nt.kind = 'sales_credit' then -1 else 1 end) * l.amount * nt.exchange_rate), ${beh}
            from adjustment_note_lines l join adjustment_notes nt on nt.id = l.note_id join parties p on p.id = nt.party_id left join tax_codes t on t.id = l.tax_code_id
            where nt.status = 'posted' and nt.kind in ('sales_credit', 'sales_debit') and nt.note_date between ${from} and ${f.to}
            group by nt.id, nt.kind, nt.number, nt.note_date, p.name_ar, 7
          ) x where x.b = ${f.tax ?? "standard"} ${f.dir === "in" ? sql`and x.kind = 'inv'` : f.dir === "out" ? sql`and x.kind <> 'inv'` : sql``} order by x.date, x.number`,
    );
    return r.map((x) => ({
      date: x.date,
      number: x.number,
      href: x.kind === "inv" ? `/invoices/${x.id}` : `/notes/sales?open=${x.id}`,
      party: x.party,
      note: x.kind === "inv" ? "فاتورة" : x.kind === "sales_credit" ? "إشعار دائن (تعديل بالنقص)" : "إشعار مدين (تعديل بالزيادة)",
      amount: r2(n(x.amount)),
    }));
  }
  if (f.doc === "vat_pzero") {
    const r = await rows<{ id: number; number: string; date: string; party: string; amount: string }>(
      db,
      sql`select pi.id, pi.number, to_char(pi.invoice_date, 'YYYY-MM-DD') as date, p.name_ar as party, sum(l.amount * pi.exchange_rate) as amount
          from purchase_invoice_lines l join purchase_invoices pi on pi.id = l.invoice_id join parties p on p.id = pi.supplier_id join tax_codes t on t.id = l.tax_code_id
          where pi.status = 'posted' and pi.invoice_date between ${from} and ${f.to} and t.behavior = ${f.tax ?? "pur_zero"}
          group by pi.id, pi.number, pi.invoice_date, p.name_ar order by pi.invoice_date, pi.id`,
    );
    return r.map((x) => ({ date: x.date, number: x.number, href: `/purchases/${x.id}`, party: x.party, note: "فاتورة مورد", amount: r2(n(x.amount)) }));
  }
  if (f.doc === "stock") {
    const w: SQL[] = [sql`m.move_date <= ${f.to}`];
    if (f.productId) w.push(sql`m.product_id = ${f.productId}`);
    if (f.warehouseId) w.push(sql`m.warehouse_id = ${f.warehouseId}`);
    if (f.dir === "open") w.push(sql`m.move_date < ${from}`);
    if (f.dir === "in") w.push(sql`m.move_date >= ${from} and m.quantity > 0`);
    if (f.dir === "out") w.push(sql`m.move_date >= ${from} and m.quantity < 0`);
    const r = await rows<{ date: string; source_type: string; source_id: number; description: string | null; qty: string; value: string; wh: string }>(
      db,
      sql`select to_char(m.move_date, 'YYYY-MM-DD') as date, m.source_type, m.source_id, m.description, m.quantity as qty, m.value, wh.name_ar as wh
          from stock_moves m join warehouses wh on wh.id = m.warehouse_id where ${sql.join(w, sql` and `)} order by m.move_date, m.id`,
    );
    const href = (t: string, id: number) => (t === "purchase_invoice" ? `/purchases/${id}` : t === "maintenance_order" ? `/maintenance/${id}` : `/inventory/docs?open=${id}`);
    const label = (t: string) => (t === "purchase_invoice" ? "فاتورة مورد" : t === "maintenance_order" ? "أمر صيانة" : "مستند مخزني");
    return r.map((x) => ({
      date: x.date,
      number: label(x.source_type),
      href: href(x.source_type, Number(x.source_id)),
      party: x.wh,
      note: `${x.description ?? ""} · الكمية ${n(x.qty).toLocaleString("en")}`.replace(/^ · /, ""),
      amount: r2(f.dir === "out" ? -n(x.value) : n(x.value)),
    }));
  }
  return [];
}
