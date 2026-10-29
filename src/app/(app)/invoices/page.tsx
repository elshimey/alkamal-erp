import { SendDocument } from "@/components/send-document";
import Link from "next/link";
import { and, asc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { fundingAccounts, currentTrip, invoicingQueue, listSalesInvoices, salesInvoiceDoc, summarizeSalesInvoices } from "@/lib/invoices";
import { PAGE_SIZE, pageOf } from "@/lib/paging";
import { driverOptions, routeOptions, vehicleOptions } from "@/lib/lookups";
import { getCompany, getInvoiceTemplate, invoiceReadiness } from "@/lib/company";
import { invoiceQrSvg } from "@/lib/zatca-qr";
import { clearedQr, getSettings, latestDocument, sendBlocker } from "@/lib/zatca/service";
import { ZatcaPanel } from "@/components/zatca-panel";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { INVOICE_STATUS, ZATCA_STATUS, paymentState } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { RowCheck, SelectAll, SelectionGate, SelectionTotal } from "@/components/row-selection";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { ClickRow } from "@/components/click-row";
import { CashAccountField } from "@/components/cash-account-field";
import { DriverSentTag } from "@/components/driver-sent";
import { InvoiceEditor, type InvoiceDraft } from "./invoice-editor";
import { invoiceActions } from "./invoice-menu";
import { TaxInvoiceDocument } from "@/components/tax-invoice";
import { Badge, EmptyRow, Input, Pager, PageHeader, Table, Td } from "@/components/ui";
import { ListActions } from "@/components/list-actions";
import { bulkInvoiceOps, invoiceAll, invoiceCustomer, issue, saveInvoicePanel, saveInvoiceSheet, sendToZatca } from "./actions";
import { ActionsMenu, type MenuItem } from "@/components/actions-menu";
import { fmt } from "@/lib/format";

const BASE = "/invoices";
const BULK_FORM = "invoice-bulk";
const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${value}`;
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const NO_TRIP: InvoiceDraft["trip"] = { on: false, routeId: "", vehicleId: "", driverId: "", shipper: "", consignee: "", custody: "" };
const STATUSES = { draft: INVOICE_STATUS.draft.label, issued: INVOICE_STATUS.issued.label };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<DocListParams & { new?: string; edit?: string }> }) {
  const user = await requirePermission("sales_invoices", "view");
  const sp = await searchParams;
  const canCreate = can(user.perms, "sales_invoices", "create");
  const canIssue = can(user.perms, "sales_invoices", "approve");
  const canUpdate = can(user.perms, "sales_invoices", "update");
  const canRevert = can(user.perms, "sales_invoices", "revert");
  const canDelete = can(user.perms, "sales_invoices", "delete");
  const lp: DocListParams = { q: sp.q, status: sp.status, period: sp.period, sort: sp.sort, view: sp.view, pay: sp.pay, page: sp.page };
  const { page, offset } = pageOf(sp.page);
  const canReceive = can(user.perms, "receipts", "create");
  const today = todayRiyadh();
  const filter = parseDocFilter(sp, Object.keys(STATUSES), today);
  const view = sp.view === "sheet" ? "sheet" : "table";
  const openId = view === "table" ? Number(sp.open) || null : null;
  const [queue, invoices, summary, openDoc, company, template] = await Promise.all([
    canCreate ? invoicingQueue(db) : Promise.resolve([]),
    listSalesInvoices(db, filter, PAGE_SIZE, offset),
    summarizeSalesInvoices(db, filter),
    openId ? salesInvoiceDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  const [zatca, zatcaDoc, blocker] = openDoc ? await Promise.all([getSettings(db), latestDocument(db, { invoiceId: openDoc.i.id }), sendBlocker(db, { invoiceId: openDoc.i.id })]) : [null, null, null];
  const qrSvg = openDoc ? await invoiceQrSvg(company, openDoc.i, await clearedQr(db, openDoc.i.id)) : null;
  const listUrl = (patch: Partial<Record<keyof DocListParams, string | undefined>> = {}) => listHref(BASE, lp, patch);
  const canSend = can(user.perms, "waybills", "update");
  const cashOpts = canSend ? await fundingAccounts(db) : [];
  const invoiceMenu = (d: NonNullable<typeof openDoc>): MenuItem[] => {
    const back = listUrl();
    return invoiceActions(d.i, d.lines, back, { canUpdate, canRevert, canDelete, canSend, trips: d.trips, cashField: <CashAccountField options={cashOpts} />, editHref: withParam(listUrl({ open: String(d.i.id) }), "edit", String(d.i.id)) });
  };

  // نافذة الإنشاء والتعديل
  const editId = canUpdate ? Number(sp.edit) || null : null;
  const creating = canCreate && sp.new === "1";
  const editDoc = editId ? await salesInvoiceDoc(db, editId) : null;
  const editing = !!editDoc && editDoc.i.status === "draft";
  const [customers, revenue, centers, currencies] =
    creating || editing
      ? await Promise.all([
          db
            .selectDistinct({ id: s.parties.id, nameAr: s.parties.nameAr, vat: s.parties.vatNumber })
            .from(s.parties)
            .innerJoin(s.partyRoles, eq(s.partyRoles.partyId, s.parties.id))
            .where(eq(s.partyRoles.role, "customer"))
            .orderBy(asc(s.parties.nameAr)),
          db
            .select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr })
            .from(s.accounts)
            .where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), like(s.accounts.code, "4%")))
            .orderBy(asc(s.accounts.code)),
          db.select({ id: s.costCenters.id, code: s.costCenters.code, nameAr: s.costCenters.nameAr }).from(s.costCenters).where(eq(s.costCenters.isActive, true)).orderBy(asc(s.costCenters.code)),
          db.select({ code: s.currencies.code }).from(s.currencies).orderBy(asc(s.currencies.code)),
        ])
      : [[], [], [], []];
  const [tripRoutes, tripVehicles, tripDrivers, editTrip] =
    creating || editing ? await Promise.all([routeOptions(), vehicleOptions("head"), driverOptions(), editing && editId ? currentTrip(db, editId) : Promise.resolve(null)]) : [[], [], [], null];
  const terms = creating || editing ? await db.select({ customerId: s.contracts.customerId, days: s.contracts.paymentTermsDays }).from(s.contracts) : [];
  const editorInitial = (): InvoiceDraft | null => {
    if (editing && editDoc) {
      const i = editDoc.i;
      return {
        id: i.id,
        number: i.number,
        customerId: String(i.customerId),
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate,
        currencyCode: i.currencyCode,
        reference: i.reference ?? "",
        notes: i.notes ?? "",
        lines: editDoc.lines
          .filter((l) => l.kind === "manual")
          .map((l) => ({
            description: l.description,
            quantity: String(Number(l.quantity ?? 1)),
            price: String(Number(l.unitPrice ?? l.amount)),
            discount: l.discountPercent ? String(Number(l.discountPercent)) : "",
            vatRate: Number(l.vatRate) > 0 ? "15" : "0",
            accountId: String(l.accountId),
            costCenterId: l.costCenterId ? String(l.costCenterId) : "",
          })),
        fixedLines: editDoc.lines.filter((l) => l.kind !== "manual").map((l) => ({ kind: l.kind === "waybill" ? "waybill" : "expense", description: l.description, amount: l.amount, vatAmount: l.vatAmount, vatRate: l.vatRate })),
        trip: editTrip
          ? {
              on: true,
              routeId: String(editTrip.routeId),
              vehicleId: String(editTrip.vehicleId),
              driverId: editTrip.driverId ? String(editTrip.driverId) : "",
              shipper: editTrip.shipper,
              consignee: editTrip.consignee,
              custody: editTrip.tripCustody ? String(editTrip.tripCustody) : "",
              number: editTrip.number,
              sent: !!editTrip.sentToDriverAt,
            }
          : { ...NO_TRIP },
      };
    }
    if (creating) return { customerId: "", invoiceDate: today, dueDate: plusDays(today, 30), currencyCode: "SAR", reference: "", notes: "", lines: [], fixedLines: [], trip: { ...NO_TRIP } };
    return null;
  };
  const initial = editorInitial();
  const editorBack = listUrl(openId ? { open: String(openId) } : {});
  const returnTo = listUrl({ open: "{id}", page: creating ? undefined : lp.page }).replace("%7Bid%7D", "{id}");
  const domestic = revenue.find((a) => a.code === "4101");

  const state = (i: (typeof invoices)[number]["i"]) => {
    const total = Number(i.total);
    const paid = Number(i.paidAmount);
    const overdue = i.status === "issued" && paid < total && i.dueDate < today;
    const pay = paymentState(total, paid);
    return { total, paid, overdue, pay: i.status === "issued" ? (overdue ? { label: "متأخرة", tone: "red" as const } : pay) : null };
  };

  return (
    <>
      <PageHeader title="فواتير المبيعات" description="فاتورة لشحنة أو لعدة شحنات مدمجة، أو فاتورة مباشرة ببنود حرة. تُحفظ مسودة برقم مسودة، وعند الاعتماد تأخذ رقمها الرسمي ويُقيد الإيراد والضريبة.">
        <ListActions bulkHref={canUpdate && "/invoices?view=sheet&status=draft"} importHref={canCreate && "/import/sales-invoices"} />
        {canCreate && (
          <Link href={withParam(listUrl(), "new", "1")} scroll={false} className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500">
            + إنشاء فاتورة
          </Link>
        )}
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
              <SubmitButton>تحويل الكل إلى مسودات فواتير (مسودة لكل عميل)</SubmitButton>
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
                      <SubmitButton variant="secondary">تحويل إلى مسودة فاتورة</SubmitButton>
                    </ActionForm>
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </details>
      )}

      <DocToolbar base={BASE} params={sp} statuses={STATUSES} exportName="فواتير-المبيعات" count={summary.n} />
      <div className="mb-2 flex justify-end">
        <BulkPdfButton kind="invoices" ids={invoices.map((x) => x.i.id)} />
      </div>

      {view === "sheet" ? (
        <>
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
          <Pager page={page} size={PAGE_SIZE} total={summary.n} hrefFor={(p) => listUrl({ page: p > 1 ? String(p) : undefined })} />
        </>
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
                  {openDoc.trips.length > 0 && (
                    <Badge tone={openDoc.trips.every((w) => w.sentAt) ? "blue" : openDoc.trips.some((w) => w.sentAt) ? "amber" : "gray"}>
                      {openDoc.trips.every((w) => w.sentAt) ? "✓ أُرسلت للسائق" : openDoc.trips.some((w) => w.sentAt) ? `أُرسلت ${openDoc.trips.filter((w) => w.sentAt).length} من ${openDoc.trips.length} للسائق` : "لم تُرسل للسائق"}
                    </Badge>
                  )}
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
                {openDoc.i.status === "draft" && canUpdate ? (
                  <Link href={withParam(listUrl({ open: String(openDoc.i.id) }), "edit", String(openDoc.i.id))} scroll={false} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                    تعديل
                  </Link>
                ) : (
                  <Link href={`/invoices/${openDoc.i.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                    فتح الفاتورة
                  </Link>
                )}
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
                    <SubmitButton>اعتماد وإصدار</SubmitButton>
                  </ActionForm>
                )}
                {invoiceMenu(openDoc).length > 0 && <ActionsMenu items={invoiceMenu(openDoc)} label="العمليات" />}
              </div>
            </div>
            <ReadinessBar company={company} />
            <div className="p-4 sm:p-6">
              <div className="mx-auto max-w-3xl">
                {openDoc.i.status === "issued" && <ZatcaPanel doc={zatcaDoc} connected={!!zatca?.token} blocker={blocker} partyHref={`/records/parties/${openDoc.i.customerId}`} send={canIssue ? sendToZatca.bind(null, openDoc.i.id) : undefined} />}
                <TaxInvoiceDocument company={company} invoice={openDoc.i} customer={openDoc.customer} lines={openDoc.lines} qrSvg={qrSvg} template={template} compact />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
          {(canIssue || canUpdate || canRevert || canDelete) && (
            <ActionForm id={BULK_FORM} action={bulkInvoiceOps} resetOnSuccess={false} className="mb-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
              <input type="hidden" name="op" defaultValue="" />
              <SelectionGate form={BULK_FORM} empty={<span className="text-sm text-gray-500">حدد فاتورة أو أكثر من الجدول لتظهر العمليات: الاعتماد، والإرجاع لمسودة، والدمج، وفك الدمج، والحذف.</span>}>
                <div className="flex flex-wrap items-center gap-2.5">
                  <SelectionTotal form={BULK_FORM} noun="فاتورة" />
                  <span className="mx-1 h-6 w-px bg-gray-200" aria-hidden />
                  {canIssue && (
                    <SubmitButton op="issue" pendingLabel="جارٍ الاعتماد…" className="!py-1.5">
                      اعتماد وإصدار
                    </SubmitButton>
                  )}
                  {canUpdate && (
                    <SubmitButton op="merge" variant="secondary" pendingLabel="جارٍ الدمج…" className="!py-1.5">
                      دمج المحدد
                    </SubmitButton>
                  )}
                  {(canUpdate || canRevert || canDelete || canSend) && (
                    <details data-dropdown className="relative">
                      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                        عمليات أخرى
                        <span aria-hidden className="text-xs text-gray-400">▾</span>
                      </summary>
                      <div className="absolute start-0 z-30 mt-1 flex w-56 flex-col rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                        {canSend && (
                          <>
                            <ConfirmSubmit
                              op="send_driver"
                              className="!justify-start !border-0 !text-start !shadow-none"
                              title="إرسال رحلات الفواتير المحددة للسائقين"
                              text="تظهر رحلة كل فاتورة في تطبيق سائقها، وما عليه عهدة رحلة تُصرف له بسند عهدة من الحساب المختار. ما أُرسل من قبل لا يُعاد إرساله."
                              submit="إرسال"
                              fields={<CashAccountField options={cashOpts} />}
                            >
                              إرسال للسائق
                            </ConfirmSubmit>
                            <ConfirmSubmit
                              op="unsend_driver"
                              className="!justify-start !border-0 !text-start !shadow-none"
                              title="إلغاء إرسال رحلات الفواتير المحددة"
                              text="تُسحب الرحلات من تطبيق السائقين وتُعكس عهدتها. ما سجّل عليه السائق تحميلاً أو تسليماً أو مصروفاً لا يُلغى."
                              submit="إلغاء الإرسال"
                            >
                              إلغاء الإرسال للسائق
                            </ConfirmSubmit>
                          </>
                        )}
                        {canRevert && (
                          <ConfirmSubmit
                            op="revert"
                            className="!justify-start !border-0 !text-start !shadow-none"
                            title="إرجاع الفواتير المحددة إلى مسودة"
                            text="يُلغى قيد الإيراد والضريبة لكل فاتورة صادرة محددة، وتحتفظ برقمها الرسمي. لا تُرجع فاتورة عليها دفعة سداد، ولا فاتورة اعتمدتها هيئة الزكاة."
                            submit="إرجاع إلى مسودة"
                          >
                            إرجاع إلى مسودة
                          </ConfirmSubmit>
                        )}
                        {canUpdate && (
                          <ConfirmSubmit
                            op="unmerge"
                            className="!justify-start !border-0 !text-start !shadow-none"
                            title="فك دمج الفواتير المحددة"
                            text="كل شحنة أو فاتورة مدمجة في المسودة تصبح فاتورة مسودة مستقلة. لا يُحذف شيء."
                            submit="فك الدمج"
                          >
                            فك الدمج
                          </ConfirmSubmit>
                        )}
                        {canDelete && (
                          <ConfirmSubmit
                            op="delete"
                            danger
                            className="!justify-start !border-0 !text-start !shadow-none"
                            title="حذف المسودات المحددة"
                            text="تُحذف الفواتير المسودة المحددة وتعود شحناتها «معتمدة · بانتظار الفوترة»، وتُحفظ نسخة في سجل المحذوفات. الفواتير الصادرة وما أخذ رقماً رسمياً لا يُحذف."
                            submit="حذف"
                            fields={
                              <label className="block text-sm">
                                <span className="mb-1 block text-gray-600">سبب الحذف</span>
                                <input name="reason" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="مثال: أُنشئت بالخطأ" />
                              </label>
                            }
                          >
                            حذف المسودات
                          </ConfirmSubmit>
                        )}
                      </div>
                    </details>
                  )}
                  <span className="ms-auto">
                    <BulkPdfButton kind="invoices" ids={invoices.map((x) => x.i.id)} />
                  </span>
                </div>
              </SelectionGate>
            </ActionForm>
          )}
          <Table
            head={[
              invoices.length && (canIssue || canUpdate || canRevert || canDelete) ? <SelectAll key="all" form={BULK_FORM} /> : "",
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
            {invoices.map(({ i, customer, waybills, parts, trips, tripsSent }) => {
              const st = state(i);
              const open = listUrl({ open: String(i.id) });
              return (
                <ClickRow key={i.id} href={open} className="transition hover:bg-brand-50/40">
                  <Td>{(canIssue || canUpdate || canRevert || canDelete) && <RowCheck form={BULK_FORM} id={i.id} amount={i.total} />}</Td>
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
                    {parts > 1 && i.status === "draft" && <span className="mt-0.5 block text-xs whitespace-nowrap text-sky-700">مدمجة{waybills > 1 ? ` · ${waybills} شحنات` : ""}</span>}
                    <DriverSentTag fleet={trips > 0} sentAt={tripsSent > 0 ? "1" : null} partial={tripsSent > 0 && tripsSent < trips ? `أُرسلت ${tripsSent} من ${trips} رحلات للسائق` : undefined} />
                  </Td>
                  <Td>{st.pay ? <Badge tone={st.pay.tone}>{st.pay.label}</Badge> : "—"}</Td>
                  <Td>
                    <Link href={open} scroll={false} aria-label="معاينة" className="inline-flex rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-700">
                      <Icon name="expand" className="size-4" />
                    </Link>
                  </Td>
                </ClickRow>
              );
            })}
          </Table>
          <Pager page={page} size={PAGE_SIZE} total={summary.n} hrefFor={(p) => listUrl({ page: p > 1 ? String(p) : undefined, open: undefined })} />
          {summary.n > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              إجمالي الفواتير بهذه الشروط <span className="ltr-nums font-semibold text-gray-700">{fmt(summary.total)}</span> ريال، والمتبقي منه{" "}
              <span className="ltr-nums font-semibold text-gray-700">{fmt(summary.due)}</span> ريال.
            </p>
          )}
        </>
      )}

      {initial && (
        <InvoiceEditor
          key={editing ? `edit-${editId}` : "new"}
          title={editing ? `تعديل الفاتورة ${initial.number}` : "فاتورة مبيعات جديدة"}
          initial={initial}
          customers={customers.map((c) => ({ value: String(c.id), label: c.nameAr, vatNumber: c.vat, days: terms.find((t) => t.customerId === c.id)?.days ?? null }))}
          accounts={[...(domestic ? [domestic] : []), ...revenue.filter((a) => a !== domestic)].map((a) => ({ value: String(a.id), label: `${a.code} ${a.nameAr}` }))}
          costCenters={centers.map((c) => ({ value: String(c.id), label: c.nameAr }))}
          currencies={currencies.map((c) => c.code)}
          routes={tripRoutes}
          vehicles={tripVehicles}
          drivers={tripDrivers}
          company={company}
          template={template}
          action={saveInvoicePanel.bind(null, editing ? editId : null)}
          closeHref={editorBack}
          savedHref={returnTo}
        />
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
