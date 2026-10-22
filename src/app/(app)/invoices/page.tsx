import { SendDocument } from "@/components/send-document";
import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { invoicingQueue, listSalesInvoices, salesInvoiceDoc } from "@/lib/invoices";
import { getCompany, getInvoiceTemplate, invoiceReadiness } from "@/lib/company";
import { invoiceQrSvg } from "@/lib/zatca-qr";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { INVOICE_STATUS, ZATCA_STATUS, paymentState } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { TaxInvoiceDocument } from "@/components/tax-invoice";
import { Badge, EmptyRow, Input, PageHeader, Table, Td } from "@/components/ui";
import { ImportLink } from "@/components/import-link";
import { invoiceAll, invoiceCustomer, issue, issueMany, saveInvoiceSheet } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BASE = "/invoices";
const ISSUE_FORM = "issue-invoices";
const STATUSES = { draft: INVOICE_STATUS.draft.label, issued: INVOICE_STATUS.issued.label };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<DocListParams> }) {
  const user = await requirePermission("sales_invoices", "view");
  const sp = await searchParams;
  const canCreate = can(user.perms, "sales_invoices", "create");
  const canIssue = can(user.perms, "sales_invoices", "approve");
  const canReceive = can(user.perms, "receipts", "create");
  const today = todayRiyadh();
  const filter = parseDocFilter(sp, Object.keys(STATUSES), today);
  const view = sp.view === "sheet" ? "sheet" : "table";
  const openId = view === "table" ? Number(sp.open) || null : null;
  const [queue, invoices, openDoc, company, template] = await Promise.all([
    canCreate ? invoicingQueue(db) : Promise.resolve([]),
    listSalesInvoices(db, filter),
    openId ? salesInvoiceDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  const qrSvg = openDoc ? await invoiceQrSvg(company, openDoc.i) : null;

  const state = (i: (typeof invoices)[number]["i"]) => {
    const total = Number(i.total);
    const paid = Number(i.paidAmount);
    const overdue = i.status === "issued" && paid < total && i.dueDate < today;
    const pay = paymentState(total, paid);
    return { total, paid, overdue, pay: i.status === "issued" ? (overdue ? { label: "متأخرة", tone: "red" as const } : pay) : null };
  };
  const drafts = invoices.filter(({ i }) => i.status === "draft");
  const totals = invoices.reduce((a, { i }) => ({ total: a.total + Number(i.total) * Number(i.exchangeRate), due: a.due + (Number(i.total) - Number(i.paidAmount)) * Number(i.exchangeRate) }), { total: 0, due: 0 });

  return (
    <>
      <PageHeader title="فواتير المبيعات" description="فاتورة تجميعية لعدة شحنات معتمدة، سطر لكل شحنة بمركز تكلفة مركبتها. الإيراد والضريبة يُقيدان عند الإصدار.">
        {canCreate && <ImportLink entity="sales-invoices" />}
      </PageHeader>

      {canCreate && queue.length > 0 && (
        <details className="group mb-5 rounded-2xl border border-brand-500/30 bg-brand-50/60 print:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500 text-brand-900">
              <Icon name="waybill" className="size-4" />
            </span>
            <span className="font-semibold text-brand-900">شحنات معتمدة بانتظار الفوترة</span>
            <Badge tone="amber">{queue.reduce((a, q) => a + q.count, 0)} شحنة</Badge>
            <span className="ms-auto text-xs text-gray-500 group-open:hidden">عرض</span>
          </summary>
          <div className="px-5 pb-4">
            <ActionForm action={invoiceAll} className="mb-3 flex flex-wrap items-center gap-3" resetOnSuccess={false}>
              <span className="text-sm text-gray-600">تاريخ الفاتورة</span>
              <Input name="invoiceDate" type="date" defaultValue={today} className="w-44" />
              <SubmitButton>فوترة الكل (فاتورة لكل عميل)</SubmitButton>
            </ActionForm>
            <Table head={["العميل", "العملة", "عدد الشحنات", "الفترة", "المبلغ قبل الضريبة", ""]}>
              {queue.map((q) => (
                <tr key={`${q.customerId}-${q.currencyCode}`}>
                  <Td className="font-medium">{q.customer}</Td>
                  <Td>{q.currencyCode}</Td>
                  <Td className="ltr-nums">{q.count}</Td>
                  <Td className="ltr-nums text-gray-500">
                    {q.from} ← {q.to}
                  </Td>
                  <Td className="ltr-nums font-semibold">{fmt(q.amount)}</Td>
                  <Td>
                    <ActionForm action={invoiceCustomer.bind(null, q.customerId, q.currencyCode)} resetOnSuccess={false}>
                      <input type="hidden" name="invoiceDate" value={today} />
                      <SubmitButton variant="secondary">إنشاء فاتورة</SubmitButton>
                    </ActionForm>
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </details>
      )}

      <DocToolbar base={BASE} params={sp} statuses={STATUSES} exportName="فواتير-المبيعات" count={invoices.length} />
      <div className="mb-2 flex justify-end">
        <BulkPdfButton kind="invoices" ids={invoices.map((x) => x.i.id)} />
      </div>

      {view === "sheet" ? (
        <DocSheet
          action={saveInvoiceSheet}
          emptyText="لا توجد فواتير بهذه الشروط"
          columns={[
            { key: "status", label: "الحالة", type: "badge", width: "5.5rem" },
            { key: "number", label: "الرقم", ltr: true, width: "8rem" },
            { key: "invoiceDate", label: "التاريخ", type: "date", editable: true, width: "8.5rem" },
            { key: "dueDate", label: "الاستحقاق", type: "date", editable: true, width: "8.5rem" },
            { key: "customer", label: "العميل", width: "12rem" },
            { key: "currency", label: "العملة", width: "4rem" },
            { key: "waybills", label: "الشحنات", ltr: true, width: "4.5rem" },
            { key: "subtotal", label: "قبل الضريبة", type: "number", width: "7rem" },
            { key: "vat", label: "الضريبة", type: "number", width: "6rem" },
            { key: "total", label: "الإجمالي", type: "number", width: "7rem" },
            { key: "paid", label: "المسدد", type: "number", width: "6.5rem" },
            { key: "due", label: "المتبقي", type: "number", width: "6.5rem" },
            { key: "pay", label: "السداد", type: "badge", width: "6rem" },
            { key: "notes", label: "ملاحظات", editable: true, width: "14rem" },
          ]}
          rows={invoices.map(({ i, customer, waybills }): DocSheetRow => {
            const st = state(i);
            return {
              id: i.id,
              href: `/invoices/${i.id}`,
              editable: i.status === "draft" && can(user.perms, "sales_invoices", "update"),
              cells: {
                number: i.number,
                invoiceDate: i.invoiceDate,
                dueDate: i.dueDate,
                customer,
                currency: i.currencyCode,
                waybills: String(waybills),
                subtotal: i.subtotal,
                vat: i.vatTotal,
                total: i.total,
                paid: i.paidAmount,
                due: String(st.total - st.paid),
                notes: i.notes,
              },
              badges: {
                status: { label: INVOICE_STATUS[i.status].label, tone: INVOICE_STATUS[i.status].tone },
                ...(st.pay ? { pay: st.pay } : {}),
              },
            };
          })}
        />
      ) : openDoc ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,22rem)_1fr]">
          {/* القائمة المختصرة بجانب المعاينة */}
          <ul className="hidden max-h-[calc(100vh-9rem)] lg:block divide-y divide-gray-100 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm print:hidden lg:sticky lg:top-4">
            {invoices.map(({ i, customer }) => {
              const st = state(i);
              const active = i.id === openId;
              return (
                <li key={i.id}>
                  <Link
                    href={listHref(BASE, sp, { open: String(i.id) })}
                    scroll={false}
                    className={`block border-s-4 px-4 py-3 transition ${active ? "border-brand-500 bg-brand-50/70" : "border-transparent hover:bg-gray-50"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-semibold text-gray-800">{customer}</span>
                      <span className="ltr-nums shrink-0 text-sm font-semibold text-brand-900">{fmt(st.total)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                      <span className="ltr-nums whitespace-nowrap">{i.number}</span>
                      <span className="text-gray-300">|</span>
                      <span className="ltr-nums whitespace-nowrap">{i.invoiceDate}</span>
                      <span className="ms-auto flex gap-1">
                        <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                        {st.pay && <Badge tone={st.pay.tone}>{st.pay.label}</Badge>}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          <section className="animate-flyout min-w-0 rounded-2xl bg-gray-100/70 shadow-inner">
            <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
              <Link href={listHref(BASE, sp, { open: undefined })} scroll={false} aria-label="إغلاق المعاينة" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                <Icon name="close" className="size-4" />
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-semibold text-brand-900">
                    فاتورة <span className="ltr-nums">{openDoc.i.number}</span>
                  </span>
                  <Badge tone={INVOICE_STATUS[openDoc.i.status].tone}>{INVOICE_STATUS[openDoc.i.status].label}</Badge>
                </div>
                <div className="text-xs text-gray-500">
                  {openDoc.customer.nameAr}
                  {openDoc.i.status === "issued" && ` · ${ZATCA_STATUS[openDoc.i.zatcaStatus]}`}
                </div>
              </div>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                {openDoc.i.status !== "draft" && <SendDocument kind="invoices" id={openDoc.i.id} label={`فاتورة ضريبية رقم ${openDoc.i.number}`} company={company.nameAr} phone={openDoc.customer.mobile} email={openDoc.customer.email} />}
                <Link href={`/invoices/${openDoc.i.id}?print=1`} target="_blank" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                  طباعة
                </Link>
                <Link href={`/invoices/${openDoc.i.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                  {openDoc.i.status === "draft" ? "تعديل" : "فتح الفاتورة"}
                </Link>
                {openDoc.i.status === "issued" && Number(openDoc.i.paidAmount) < Number(openDoc.i.total) && canReceive && (
                  <Link href={`/receipts/new?customer=${openDoc.i.customerId}&invoice=${openDoc.i.id}`} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
                    تسجيل دفعة
                  </Link>
                )}
                {openDoc.i.status === "issued" && can(user.perms, "sales_invoices", "create") && (
                  <Link href={`/notes/sales/new?kind=sales_credit&party=${openDoc.i.customerId}&invoice=${openDoc.i.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                    إشعار دائن
                  </Link>
                )}
                {openDoc.i.status === "draft" && canIssue && (
                  <ActionForm action={issue.bind(null, openDoc.i.id)} resetOnSuccess={false}>
                    <SubmitButton>إصدار وترحيل القيد</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
            <ReadinessBar company={company} />
            <div className="p-4 sm:p-6">
              <div className="mx-auto max-w-3xl">
                <TaxInvoiceDocument company={company} invoice={openDoc.i} customer={openDoc.customer} lines={openDoc.lines} qrSvg={qrSvg} template={template} compact />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
          {canIssue && drafts.length > 0 && (
            <ActionForm id={ISSUE_FORM} action={issueMany} className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
              <SelectionTotal form={ISSUE_FORM} noun="فاتورة" />
              <SubmitButton variant="secondary">إصدار المحدد</SubmitButton>
              <span className="text-xs text-gray-400">حدد المسودات من الجدول؛ تُصدر كل فاتورة بقيدها.</span>
            </ActionForm>
          )}
          <Table
            head={[
              canIssue && drafts.length ? <SelectAll key="all" form={ISSUE_FORM} /> : "",
              "الرقم",
              "التاريخ",
              "الاستحقاق",
              "العميل",
              "الإجمالي",
              "المتبقي",
              "الحالة",
              "السداد",
              "",
            ]}
          >
            {invoices.length === 0 && <EmptyRow cols={10}>{filter.q || filter.status || filter.pay || filter.from ? "لا توجد فواتير بهذه الشروط" : "لا توجد فواتير بعد"}</EmptyRow>}
            {invoices.map(({ i, customer }) => {
              const st = state(i);
              const open = listHref(BASE, sp, { open: String(i.id) });
              return (
                <tr key={i.id} className="transition hover:bg-brand-50/40">
                  <Td>{canIssue && i.status === "draft" && <RowCheck form={ISSUE_FORM} id={i.id} amount={i.total} />}</Td>
                  <Td className="font-medium whitespace-nowrap">
                    <Link href={open} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                      {i.number}
                    </Link>
                  </Td>
                  <Td className="ltr-nums whitespace-nowrap">{i.invoiceDate}</Td>
                  <Td className={`ltr-nums whitespace-nowrap ${st.overdue ? "font-semibold text-red-600" : ""}`}>{i.dueDate}</Td>
                  <Td>
                    <Link href={open} scroll={false} className="hover:text-brand-700">
                      {customer}
                    </Link>
                  </Td>
                  <Td className="ltr-nums font-semibold whitespace-nowrap">
                    {fmt(st.total)} <span className="text-xs font-normal text-gray-400">{i.currencyCode}</span>
                  </Td>
                  <Td className="ltr-nums">{fmt(st.total - st.paid)}</Td>
                  <Td>
                    <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                  </Td>
                  <Td>{st.pay ? <Badge tone={st.pay.tone}>{st.pay.label}</Badge> : "—"}</Td>
                  <Td>
                    <Link href={open} scroll={false} aria-label="معاينة" className="inline-flex rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-700">
                      <Icon name="expand" className="size-4" />
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </Table>
          {invoices.length > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              إجمالي المعروض <span className="ltr-nums font-semibold text-gray-700">{fmt(totals.total)}</span> ريال، والمتبقي منه{" "}
              <span className="ltr-nums font-semibold text-gray-700">{fmt(totals.due)}</span> ريال.
            </p>
          )}
        </>
      )}
    </>
  );
}

function ReadinessBar({ company }: { company: Awaited<ReturnType<typeof getCompany>> }) {
  const r = invoiceReadiness(company);
  if (r.percent === 100)
    return (
      <div className="flex items-center gap-2 border-b border-green-100 bg-green-50 px-5 py-2 text-xs text-green-800">
        <Icon name="shield" className="size-4" />
        بيانات المنشأة مكتملة للفاتورة الضريبية، والرمز بمتطلبات هيئة الزكاة.
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-900">
      <Icon name="alert" className="size-4" />
      بيانات المنشأة ناقصة للفاتورة الضريبية: {r.missing.join("، ")}.
      <Link href="/settings/company" className="font-semibold underline">
        أكملها
      </Link>
    </div>
  );
}
