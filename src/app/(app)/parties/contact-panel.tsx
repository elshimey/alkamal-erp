import Link from "next/link";
import { db } from "@/db";
import type * as s from "@/db/schema";
import { can, type PermissionSet } from "@/lib/permissions";
import { PARTY_ROLES } from "@/data/operations";
import { contactStatement, contactSummary, listPeople } from "@/lib/contacts";
import { todayRiyadh } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Input } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { addPersonAction, removePersonAction, updatePersonAction } from "./actions";
import { DateInput } from "@/components/date-input";

const TABS = { summary: "الملخص", details: "تفاصيل جهة الاتصال", people: "الأشخاص", statement: "كشف الحساب" } as const;
type Tab = keyof typeof TABS;

const money = (v: number, accent = false) => (
  <span className={`ltr-nums font-display text-2xl font-semibold ${accent ? "text-brand-800" : "text-gray-800"}`} dir="ltr">
    {fmt(v)} <span className="text-xs font-normal text-gray-400">SAR</span>
  </span>
);

export async function ContactPanel({
  party: p,
  roles,
  tab: rawTab,
  from: rawFrom,
  to: rawTo,
  closeHref,
  tabHref,
  canEdit,
  perms,
}: {
  party: typeof s.parties.$inferSelect;
  roles: string[];
  tab?: string;
  from?: string;
  to?: string;
  closeHref: string;
  tabHref: (t: string) => string;
  canEdit: boolean;
  perms: PermissionSet;
}) {
  const tab: Tab = rawTab && rawTab in TABS ? (rawTab as Tab) : "summary";
  const today = todayRiyadh();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(rawFrom ?? "") ? rawFrom! : `${today.slice(0, 4)}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(rawTo ?? "") ? rawTo! : today;
  const isCustomer = roles.includes("customer");
  const create = [
    isCustomer && can(perms, "receipts", "create") && { href: `/receipts/new?customer=${p.id}`, label: "سند قبض" },
    isCustomer && can(perms, "sales_invoices", "create") && { href: "/invoices", label: "فاتورة مبيعات" },
    isCustomer && can(perms, "sales_invoices", "create") && { href: "/quotations", label: "عرض سعر" },
    isCustomer && can(perms, "waybills", "create") && { href: "/waybills", label: "شحنة" },
    !isCustomer && can(perms, "purchase_invoices", "create") && { href: "/purchases", label: "فاتورة مورد" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <section className="min-w-0 rounded-2xl border border-black/[0.06] bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3">
        <Link href={closeHref} scroll={false} aria-label="إغلاق" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          ✕
        </Link>
        <h2 className="font-display text-lg font-semibold text-gray-800">{p.nameAr}</h2>
        <div className="flex flex-wrap gap-1">
          {roles.map((r) => (
            <Badge key={r} tone="blue">
              {PARTY_ROLES[r as keyof typeof PARTY_ROLES]}
            </Badge>
          ))}
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {roles.includes("customer") && (
            <Link href={`/fleet-documents/owner/customer-${p.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              الوثائق
            </Link>
          )}
          {canEdit && (
            <Link href={`/records/parties/${p.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              ✎ تعديل جهة الاتصال
            </Link>
          )}
          {create.length > 0 && (
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-900 hover:bg-brand-500">
                إنشاء <span className="text-xs">▾</span>
              </summary>
              <div className="absolute end-0 z-30 mt-1 w-40 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg">
                {create.map((c) => (
                  <Link key={c.label} href={c.href} className="block px-4 py-2 hover:bg-gray-50">
                    {c.label}
                  </Link>
                ))}
              </div>
            </details>
          )}
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-gray-100 px-3 text-sm print:hidden">
        {Object.entries(TABS).map(([k, label]) => (
          <Link key={k} href={tabHref(k)} scroll={false} className={`border-b-2 px-3 py-2.5 whitespace-nowrap ${tab === k ? "border-brand-600 font-semibold text-brand-900" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="p-5">
        {tab === "summary" && <Summary id={p.id} />}
        {tab === "details" && <Details p={p} />}
        {tab === "people" && <People partyId={p.id} canEdit={canEdit} />}
        {tab === "statement" && <Statement p={p} from={from} to={to} />}
      </div>
    </section>
  );
}

async function Summary({ id }: { id: number }) {
  const b = await contactSummary(db, id);
  const box = "rounded-xl border border-gray-200 p-4";
  return (
    <>
      <p className="mb-4 text-xs leading-relaxed text-gray-500">الأرصدة من القيود المرحّلة على حساب العملاء (1103) وحسابات الموردين (2101 إلى 2105) فقط، ولا تشمل أي حسابات أخرى.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`${box} sm:row-span-2`}>
          <div className="text-sm font-semibold text-gray-800">صافي الرصيد</div>
          <div className="mb-3 text-xs text-gray-500">اعتباراً من اليوم · الموجب مستحق لنا والسالب مستحق له</div>
          {money(b.net, true)}
        </div>
        <div className={box}>
          <div className="text-sm font-semibold text-gray-800">رصيد حساب العملاء</div>
          <div className="mb-2 text-xs text-gray-500">المستحق لنا عليه</div>
          {money(b.receivable)}
        </div>
        <div className={box}>
          <div className="text-sm font-semibold text-gray-800">رصيد حساب الموردين</div>
          <div className="mb-2 text-xs text-gray-500">المستحق له علينا</div>
          {money(b.payable)}
        </div>
      </div>
    </>
  );
}

function Details({ p }: { p: typeof s.parties.$inferSelect }) {
  const rows: [string, string | null, boolean?][] = [
    ["الاسم", p.nameAr],
    ["الاسم بالإنجليزية", p.nameEn, true],
    ["النوع", p.kind === "individual" ? "فرد" : "منشأة"],
    ["الرقم الضريبي", p.vatNumber, true],
    ["السجل التجاري", p.crNumber, true],
    ["الجوال", p.mobile, true],
    ["البريد الإلكتروني", p.email, true],
    ["الدولة", p.country, true],
    ["المدينة", p.city],
    ["الحي", p.district],
    ["الشارع", p.street],
    ["رقم المبنى", p.buildingNo, true],
    ["الرمز البريدي", p.postalCode, true],
    ["الرقم الإضافي", p.additionalNo, true],
    ["العملة الافتراضية", p.defaultCurrency, true],
    ["الحالة", p.isActive ? "نشط" : "موقوف"],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v, ltr]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-gray-100 pb-2">
          <dt className="text-gray-500">{k}</dt>
          <dd className={`text-gray-800 ${ltr ? "ltr-nums" : ""}`} dir={ltr ? "ltr" : undefined}>
            {v || <span className="text-gray-300">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

async function People({ partyId, canEdit }: { partyId: number; canEdit: boolean }) {
  const people = await listPeople(db, partyId);
  return (
    <div className="flex flex-col gap-4">
      {people.length === 0 && <p className="text-sm text-gray-500">لا يوجد أشخاص مرتبطون بهذه الجهة بعد.</p>}
      {people.map((x) =>
        canEdit ? (
          <details key={x.id} className="rounded-xl border border-gray-200">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="font-semibold text-gray-800">{x.name}</span>
              {x.position && <span className="text-gray-500">{x.position}</span>}
              {x.mobile && <span className="ltr-nums text-gray-600" dir="ltr">{x.mobile}</span>}
              {x.email && <span className="ltr-nums text-gray-600">{x.email}</span>}
              <span className="ms-auto text-xs text-brand-700">تعديل</span>
            </summary>
            <div className="border-t border-gray-100 p-4">
              <PersonForm action={updatePersonAction.bind(null, partyId, x.id)} values={x} label="حفظ" />
              <ActionForm action={removePersonAction.bind(null, partyId, x.id)} className="mt-2">
                <button className="text-xs text-red-600 hover:underline">حذف هذا الشخص</button>
              </ActionForm>
            </div>
          </details>
        ) : (
          <div key={x.id} className="flex flex-wrap gap-x-4 rounded-xl border border-gray-200 px-4 py-3 text-sm">
            <span className="font-semibold">{x.name}</span>
            <span className="text-gray-500">{x.position}</span>
            <span className="ltr-nums" dir="ltr">{x.mobile}</span>
            <span className="ltr-nums">{x.email}</span>
          </div>
        ),
      )}
      {canEdit && (
        <div className="rounded-xl border border-dashed border-gray-300 p-4">
          <div className="mb-3 text-sm font-semibold text-gray-700">+ إضافة شخص</div>
          <PersonForm action={addPersonAction.bind(null, partyId)} label="إضافة" />
        </div>
      )}
    </div>
  );
}

function PersonForm({ action, values, label }: { action: Parameters<typeof ActionForm>[0]["action"]; values?: { name: string; position: string | null; mobile: string | null; email: string | null; notes: string | null }; label: string }) {
  return (
    <ActionForm action={action} resetOnSuccess={!values} className="grid gap-2 sm:grid-cols-2">
      <Input name="name" placeholder="الاسم *" required defaultValue={values?.name} />
      <Input name="position" placeholder="المنصب (مدير المشتريات، المحاسب…)" defaultValue={values?.position ?? ""} />
      <Input name="mobile" placeholder="الجوال" dir="ltr" defaultValue={values?.mobile ?? ""} />
      <Input name="email" placeholder="البريد الإلكتروني" dir="ltr" defaultValue={values?.email ?? ""} />
      <Input name="notes" placeholder="ملاحظات" className="sm:col-span-2" defaultValue={values?.notes ?? ""} />
      <div>
        <SubmitButton className="!py-1.5">{label}</SubmitButton>
      </div>
    </ActionForm>
  );
}

async function Statement({ p, from, to }: { p: typeof s.parties.$inferSelect; from: string; to: string }) {
  const st = await contactStatement(db, p.id, from, to);
  const bal = (v: number) => (
    <span className="ltr-nums" dir="ltr">
      {fmt(Math.abs(v))} {Math.abs(v) < 0.005 ? "" : v > 0 ? "مدين" : "دائن"}
    </span>
  );
  return (
    <div>
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm print:hidden">
        <input type="hidden" name="open" value={p.id} />
        <input type="hidden" name="ptab" value="statement" />
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          من
          <DateInput name="from" defaultValue={from} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          إلى
          <DateInput name="to" defaultValue={to} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-50">عرض</button>
        <div className="ms-auto">
          <PrintButton label="طباعة الكشف" />
        </div>
      </form>
      <h3 className="mb-2 hidden text-center font-display text-lg font-semibold print:block">
        كشف حساب {p.nameAr} من {from} إلى {to}
      </h3>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              {["التاريخ", "القيد", "البيان", "الحساب", "مدين", "دائن", "الرصيد"].map((h) => (
                <th key={h} className="px-3 py-2 text-start font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr className="bg-gray-50/50">
              <td className="px-3 py-2 text-gray-500" colSpan={6}>
                رصيد افتتاحي قبل {from}
              </td>
              <td className="px-3 py-2 font-semibold">{bal(st.opening)}</td>
            </tr>
            {st.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                  لا توجد حركات مرحّلة في هذه الفترة
                </td>
              </tr>
            )}
            {st.rows.map((r, i) => (
              <tr key={i}>
                <td className="ltr-nums px-3 py-2 whitespace-nowrap">{String(r.entry_date).slice(0, 10)}</td>
                <td className="px-3 py-2">
                  <Link href={`/journal?open=${r.entry_id}`} className="ltr-nums whitespace-nowrap text-brand-700 hover:underline">
                    {r.number}
                  </Link>
                </td>
                <td className="max-w-[16rem] px-3 py-2"><div className="line-clamp-1" title={r.description ?? ""}>{r.description ?? "—"}</div></td>
                <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-500">
                  {r.code} {r.account}
                </td>
                <td className="ltr-nums px-3 py-2 whitespace-nowrap">{r.debit ? fmt(r.debit) : ""}</td>
                <td className="ltr-nums px-3 py-2 whitespace-nowrap">{r.credit ? fmt(r.credit) : ""}</td>
                <td className="px-3 py-2 whitespace-nowrap">{bal(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-semibold">
            <tr>
              <td className="px-3 py-2" colSpan={4}>
                الإجمالي والرصيد الختامي
              </td>
              <td className="ltr-nums px-3 py-2">{fmt(st.debit)}</td>
              <td className="ltr-nums px-3 py-2">{fmt(st.credit)}</td>
              <td className="px-3 py-2">{bal(st.closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
