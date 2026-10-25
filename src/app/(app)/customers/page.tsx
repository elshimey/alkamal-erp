import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { CUSTOMER_FILTERS, CUSTOMER_SORTS, customerActivity, listCustomers, type CustomerFilter } from "@/lib/customers";
import { listHref, type DocListParams } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { INVOICE_STATUS, RECEIPT_KINDS, paymentState } from "@/data/sales";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { ImportLink } from "@/components/import-link";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { fmt } from "@/lib/format";

const BASE = "/customers";
const btn = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<DocListParams> }) {
  const user = await requirePermission("parties", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const filter = sp.status && sp.status in CUSTOMER_FILTERS ? (sp.status as CustomerFilter) : undefined;
  const sort = sp.sort && sp.sort in CUSTOMER_SORTS ? (sp.sort as keyof typeof CUSTOMER_SORTS) : undefined;
  const list = await listCustomers(db, { q: sp.q?.trim() || undefined, filter, sort, today });
  const openId = Number(sp.open) || null;
  const open = openId ? list.find((c) => c.p.id === openId) : undefined;
  const activity = open ? await customerActivity(db, open.p.id) : null;
  const totals = list.reduce((a, c) => ({ outstanding: a.outstanding + c.outstanding, overdue: a.overdue + c.overdue, credit: a.credit + c.credit }), { outstanding: 0, overdue: 0, credit: 0 });
  const canReceive = can(user.perms, "receipts", "create");

  const money = (v: number, tone = "text-gray-800") => (v > 0.005 ? <span className={`ltr-nums font-semibold ${tone}`}>{fmt(v)}</span> : <span className="text-gray-300">—</span>);

  return (
    <>
      <PageHeader title="العملاء" description="أرصدة العملاء المستحقة والمتأخرة والدائنة. اضغط العميل لرؤية فواتيره وسنداته.">
        {can(user.perms, "parties", "create") && (
          <div className="flex flex-wrap items-center gap-2">
            <ImportLink entity="customers" label="استيراد العملاء" />
            <Link href="/parties" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
              + عميل جديد
            </Link>
          </div>
        )}
      </PageHeader>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          ["المستحق على العملاء", totals.outstanding, "text-brand-900"],
          ["منها متأخرة", totals.overdue, "text-red-700"],
          ["أرصدة دائنة للعملاء", totals.credit, "text-sky-800"],
        ].map(([label, v, tone]) => (
          <div key={label as string} className="rounded-2xl border border-black/[0.06] bg-white px-5 py-4 shadow-sm">
            <div className="text-xs text-gray-500">{label}</div>
            <div className={`ltr-nums mt-1 font-display text-2xl font-semibold ${tone}`}>
              {fmt(v as number)} <span className="text-xs font-normal text-gray-400">SAR</span>
            </div>
          </div>
        ))}
      </div>

      <DocToolbar base={BASE} params={sp} statuses={CUSTOMER_FILTERS} allStatuses="كل العملاء" pay={false} views={false} period={false} sorts={CUSTOMER_SORTS} noun="عميل" exportName="العملاء" count={list.length} placeholder="ابحث بالاسم أو الرقم الضريبي أو الجوال" />

      <div className={open ? "grid items-start gap-4 lg:grid-cols-[1fr_minmax(20rem,28rem)]" : ""}>
        <Table head={["العميل", "الفواتير المفتوحة", "المستحق", "المتأخر", "رصيد دائن", "آخر فاتورة"]}>
          {list.length === 0 && <EmptyRow cols={6}>{sp.q || filter ? "لا يوجد عملاء بهذه الشروط" : "لا يوجد عملاء بعد"}</EmptyRow>}
          {list.map((c) => (
            <tr key={c.p.id} className={`transition hover:bg-brand-50/40 ${c.p.id === openId ? "bg-brand-50/70" : ""}`}>
              <Td>
                <Link href={listHref(BASE, sp, { open: c.p.id === openId ? undefined : String(c.p.id) })} scroll={false} className="font-medium text-brand-700 hover:underline">
                  {c.p.nameAr}
                </Link>
                {c.p.vatNumber && <div className="ltr-nums text-[11px] text-gray-400">{c.p.vatNumber}</div>}
              </Td>
              <Td className="ltr-nums">{c.openCount || <span className="text-gray-300">—</span>}</Td>
              <Td>{money(c.outstanding)}</Td>
              <Td>{money(c.overdue, "text-red-700")}</Td>
              <Td>{money(c.credit, "text-sky-800")}</Td>
              <Td className="ltr-nums text-xs text-gray-500">{c.lastInvoice ?? "—"}</Td>
            </tr>
          ))}
        </Table>

        {open && activity && (
          <aside className="animate-flyout rounded-2xl border border-black/[0.06] bg-white shadow-sm lg:sticky lg:top-4">
            <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-semibold text-brand-900">{open.p.nameAr}</div>
                <div className="flex flex-wrap gap-x-3 text-xs text-gray-500">
                  {open.p.nameEn && <span dir="ltr">{open.p.nameEn}</span>}
                  {open.p.mobile && <span className="ltr-nums">{open.p.mobile}</span>}
                  {open.p.email && <span dir="ltr">{open.p.email}</span>}
                </div>
              </div>
              <Link href={`/fleet-documents/owner/customer-${open.p.id}`} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-brand-700 hover:bg-brand-50">
                الوثائق
              </Link>
              <Link href={listHref(BASE, sp, { open: undefined })} scroll={false} aria-label="إغلاق" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                <Icon name="close" className="size-4" />
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2 px-5 py-4 text-center">
              {[
                ["المستحق", open.outstanding, "text-brand-900"],
                ["المتأخر", open.overdue, "text-red-700"],
                ["رصيد دائن", open.credit, "text-sky-800"],
              ].map(([l, v, tone]) => (
                <div key={l as string} className="rounded-xl bg-gray-50 px-2 py-2.5">
                  <div className="text-[11px] text-gray-500">{l}</div>
                  <div className={`ltr-nums font-semibold ${tone}`}>{fmt(v as number)}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 px-5 pb-4">
              {canReceive && (
                <Link href={`/receipts/new?customer=${open.p.id}`} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
                  تسجيل دفعة
                </Link>
              )}
              {canReceive && open.credit > 0.005 && (
                <Link href={`/receipts/new?kind=refund&customer=${open.p.id}`} className={btn}>
                  استرداد
                </Link>
              )}
              <Link href={`/invoices?q=${encodeURIComponent(open.p.nameAr)}`} className={btn}>
                كل الفواتير
              </Link>
              <Link href={`/receipts?q=${encodeURIComponent(open.p.nameAr)}`} className={btn}>
                كل السندات
              </Link>
            </div>

            <h3 className="border-t border-gray-100 px-5 pt-4 pb-2 text-sm font-semibold text-gray-800">آخر الفواتير</h3>
            <ul className="divide-y divide-gray-50 px-5 text-sm">
              {activity.invoices.length === 0 && <li className="py-3 text-xs text-gray-400">لا توجد فواتير</li>}
              {activity.invoices.map((i) => {
                const st = i.status === "issued" ? paymentState(Number(i.total), Number(i.paid)) : INVOICE_STATUS.draft;
                const late = i.status === "issued" && Number(i.paid) < Number(i.total) && i.dueDate < today;
                return (
                  <li key={i.id} className="flex items-center gap-2 py-2">
                    <Link href={`/invoices?open=${i.id}`} className="ltr-nums font-medium text-brand-700 hover:underline">
                      {i.number}
                    </Link>
                    <span className="ltr-nums text-xs text-gray-400">{i.invoiceDate}</span>
                    <span className="ms-auto ltr-nums text-xs">{fmt(i.total)}</span>
                    <Badge tone={late ? "red" : st.tone}>{late ? "متأخرة" : st.label}</Badge>
                  </li>
                );
              })}
            </ul>
            <h3 className="mt-2 border-t border-gray-100 px-5 pt-4 pb-2 text-sm font-semibold text-gray-800">آخر السندات</h3>
            <ul className="divide-y divide-gray-50 px-5 pb-4 text-sm">
              {activity.receipts.length === 0 && <li className="py-3 text-xs text-gray-400">لا توجد سندات</li>}
              {activity.receipts.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2">
                  <Link href={`/receipts?open=${r.id}`} className="ltr-nums font-medium text-brand-700 hover:underline">
                    {r.number}
                  </Link>
                  <span className="ltr-nums text-xs text-gray-400">{r.receiptDate}</span>
                  <span className="ms-auto ltr-nums text-xs">{fmt(r.amount)}</span>
                  <Badge tone={RECEIPT_KINDS[r.kind].tone}>{RECEIPT_KINDS[r.kind].short}</Badge>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </>
  );
}
