import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listQuotations, parseQuoteFilter, quotationDoc, quotationLinesFor, QUOTE_SORTS, QUOTE_STATUS, SHIPPING_TYPES, type QuoteListParams } from "@/lib/quotations";
import { routeOptions } from "@/lib/lookups";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { todayRiyadh } from "@/lib/dates";
import { listHref } from "@/lib/doc-filters";
import { fmt } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ClickRow } from "@/components/click-row";
import { ActionsMenu, type MenuItem } from "@/components/actions-menu";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { QuotationDocument } from "@/components/commercial-documents";
import { DateInput } from "@/components/date-input";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { SendDocument } from "@/components/send-document";
import { Badge, EmptyRow, LimitRow, PageHeader, Table, Td } from "@/components/ui";
import { bulkQuotations, convertQuotation, copyQuotation, quotationStatus, removeQuotation, saveQuotationPanel, saveQuotationSheet } from "./actions";
import { QuotationEditor, type QuoteDraft } from "./quotation-editor";

const BASE = "/quotations";
const BULK_FORM = "quote-bulk";
const STATUSES = Object.fromEntries(Object.entries(QUOTE_STATUS).map(([k, v]) => [k, v.label]));
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** يضيف معاملاً لرابط قد يحمل معاملات أخرى. */
const withParam = (url: string, key: string, value: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${value}`;

type Params = QuoteListParams & { new?: string; add?: string; edit?: string };
type Row = Awaited<ReturnType<typeof listQuotations>>[number];

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission("sales_invoices", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const canCreate = can(user.perms, "sales_invoices", "create");
  const canUpdate = can(user.perms, "sales_invoices", "update");
  const canDelete = can(user.perms, "sales_invoices", "delete");
  const view = sp.view === "sheet" ? "sheet" : "table";
  // معاملات القائمة فقط، فلا تبقى نافذة التعديل مفتوحة في الروابط
  const lp: QuoteListParams = { q: sp.q, status: sp.status, period: sp.period, sort: sp.sort, view: sp.view };
  const openId = view === "table" ? Number(sp.open) || null : null;
  const editId = Number(sp.edit) || null;
  const creating = canCreate && (sp.new === "1" || sp.add === "1");
  const filter = parseQuoteFilter(sp, today);

  const [rows, openDoc, editDoc, company, template] = await Promise.all([
    listQuotations(db, filter),
    openId ? quotationDoc(db, openId) : Promise.resolve(null),
    editId && canUpdate ? quotationDoc(db, editId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  const lines = view === "sheet" ? await quotationLinesFor(db, rows.map((r) => r.q.id)) : [];
  const editing = !!editDoc && !editDoc.q.salesInvoiceId && editDoc.q.status !== "cancelled";
  const needOptions = view === "sheet" || creating || editing;
  const [customers, routes, currencies] = needOptions
    ? await Promise.all([
        db
          .selectDistinct({ id: s.parties.id, nameAr: s.parties.nameAr, vat: s.parties.vatNumber })
          .from(s.parties)
          .innerJoin(s.partyRoles, eq(s.partyRoles.partyId, s.parties.id))
          .where(eq(s.partyRoles.role, "customer"))
          .orderBy(asc(s.parties.nameAr)),
        routeOptions(),
        db.select({ code: s.currencies.code }).from(s.currencies).orderBy(asc(s.currencies.code)),
      ])
    : [[], [], []];
  const customerOpts = customers.map((c) => ({ value: String(c.id), label: c.nameAr, vatNumber: c.vat }));
  const routeOpts = routes.map((r) => ({ ...r, fill: { description: `نقل ${r.label}` } }));

  const listUrl = (patch: Partial<Record<keyof QuoteListParams, string | undefined>> = {}) => listHref(BASE, lp, patch);
  const back = listUrl(openId ? { open: String(openId) } : {});
  const editable = (q: Row["q"]) => canUpdate && !q.salesInvoiceId && q.status !== "cancelled";

  /** عمليات العرض الواحد في قائمة «العمليات». */
  const menu = (q: Row["q"]): MenuItem[] => {
    const invoiced = !!q.salesInvoiceId;
    const items: MenuItem[] = [];
    if (canUpdate && !invoiced) {
      if (q.status === "draft") items.push({ label: "تعليم كمُرسل", icon: "send", action: quotationStatus.bind(null, q.id, "sent") });
      if (q.status === "draft" || q.status === "sent") {
        items.push({ label: "قبِله العميل", icon: "check", action: quotationStatus.bind(null, q.id, "accepted") });
        items.push({ label: "رفضه العميل", icon: "close", action: quotationStatus.bind(null, q.id, "rejected") });
      }
      if (q.status !== "draft") items.push({ label: "العودة إلى مسودة", icon: "undo", action: quotationStatus.bind(null, q.id, "draft") });
    }
    if (invoiced) items.push({ label: "عرض الفاتورة", icon: "invoice", href: `/invoices?open=${q.salesInvoiceId}` });
    else if (canCreate && q.status !== "rejected" && q.status !== "cancelled")
      items.push({
        label: "تحويل إلى فاتورة",
        icon: "invoice",
        hint: "فاتورة مسودة بنفس البنود، ويُعلَّم العرض مقبولاً",
        divider: true,
        action: convertQuotation.bind(null, q.id),
        confirm: {
          title: `تحويل العرض ${q.number} إلى فاتورة`,
          text: "تُنشأ فاتورة مبيعات مسودة بنفس البنود والأسعار والضريبة لتراجعها ثم تعتمدها.",
          submit: "إنشاء الفاتورة",
          fields: (
            <label className="block text-sm">
              <span className="mb-1 block text-gray-600">تاريخ الفاتورة</span>
              <DateInput name="invoiceDate" defaultValue={today} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
          ),
        },
      });
    if (canUpdate && !invoiced && q.status !== "cancelled")
      items.push({
        label: "إلغاء العرض",
        icon: "ban",
        action: quotationStatus.bind(null, q.id, "cancelled"),
        confirm: { title: `إلغاء العرض ${q.number}`, text: "يبقى العرض في القائمة بحالة «ملغى» ولا يُعدّل، ويمكن إعادته لمسودة لاحقاً.", submit: "إلغاء العرض" },
      });
    if (canCreate) items.push({ label: "نسخ العرض", icon: "copy", hint: "عرض جديد مسودة بنفس البنود", divider: true, action: copyQuotation.bind(null, q.id, listUrl()) });
    items.push({ label: "طباعة", icon: "printer", href: `/print/quotations?ids=${q.id}&print=1`, newTab: true });
    items.push({ label: "تنزيل PDF", icon: "download", href: `/print/quotations?ids=${q.id}&pdf=1`, newTab: true });
    if (canDelete && !invoiced)
      items.push({
        label: "حذف",
        icon: "trash",
        danger: true,
        divider: true,
        action: removeQuotation.bind(null, q.id, listUrl()),
        confirm: { title: `حذف العرض ${q.number}`, text: "يُحذف العرض وبنوده نهائياً. لا يمكن التراجع.", submit: "حذف نهائياً" },
      });
    return items;
  };

  const exportQuery = new URLSearchParams(Object.entries({ q: lp.q, status: lp.status, period: lp.period, sort: lp.sort }).filter((e): e is [string, string] => !!e[1])).toString();
  const pageMenu: MenuItem[] = [
    ...(canCreate ? [{ label: "الاستيراد من Excel", icon: "upload" as const, href: "/import/quotations" }] : []),
    { label: "تصدير إلى Excel", icon: "download", href: `${BASE}/export?format=xlsx&${exportQuery}`, download: true, divider: canCreate, hint: "بند في كل صف حسب الفلتر الحالي" },
    { label: "تصدير إلى CSV", icon: "download", href: `${BASE}/export?format=csv&${exportQuery}`, download: true },
    { label: "نسخ إلى الحافظة", icon: "copy", copyFrom: `${BASE}/export?format=tsv&${exportQuery}`, hint: "للصق مباشرة في Excel" },
  ];

  const editorInitial = (): QuoteDraft | null => {
    if (editing && editDoc) {
      const q = editDoc.q;
      const vat = SHIPPING_TYPES[q.shippingType].vat;
      return {
        number: q.number,
        customerId: String(q.customerId),
        date: q.quoteDate,
        validUntil: q.validUntil,
        currencyCode: q.currencyCode,
        shippingType: q.shippingType,
        reference: q.reference ?? "",
        notes: q.notes ?? "",
        terms: q.terms ?? "",
        lines: editDoc.lines.map((l) => ({
          routeId: l.routeId ? String(l.routeId) : "",
          description: l.description,
          quantity: String(Number(l.quantity)),
          price: String(Number(l.unitPrice)),
          vatRate: Number(l.vatRate) === vat ? "" : String(Number(l.vatRate)),
        })),
      };
    }
    if (creating) return { customerId: "", date: today, validUntil: plusDays(today, 15), currencyCode: "SAR", shippingType: "international", reference: "", notes: "", terms: template.terms, lines: [] };
    return null;
  };
  const initial = editorInitial();
  const returnTo = view === "sheet" ? listUrl() : listUrl({ open: "{id}" }).replace("%7Bid%7D", "{id}");

  const lineRows = Map.groupBy(lines, (l) => l.quotationId);
  const total = rows.reduce((t, { q }) => t + Number(q.total), 0);

  return (
    <>
      <PageHeader title="عروض الأسعار" description="عرض سعر للعميل بالمسارات والأسعار ونوع الشحن (الدولي بضريبة صفرية والداخلي 15%)، يُرسل ويُطبع، وعند قبوله يتحول بضغطة إلى فاتورة مسودة.">
        {canCreate && (
          <Link href={withParam(listUrl(), "new", "1")} scroll={false} className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500">
            + إنشاء
          </Link>
        )}
      </PageHeader>

      <DocToolbar
        base={BASE}
        params={lp}
        statuses={STATUSES}
        exportName="عروض-الأسعار"
        count={rows.length}
        noun="عرض"
        pay={false}
        sorts={QUOTE_SORTS}
        exportable={false}
        placeholder="ابحث برقم العرض أو العميل أو المرجع أو البند أو المبلغ"
        extra={<ActionsMenu items={pageMenu} />}
      />

      {view === "sheet" ? (
        <DocSheet
          action={saveQuotationSheet}
          emptyText={filter.q || filter.status || filter.from ? "لا توجد عروض بهذه الشروط" : "لا توجد عروض أسعار بعد"}
          columns={[
            { key: "status", label: "الحالة", type: "badge", width: "6rem" },
            { key: "number", label: "الرقم", ltr: true, width: "7.5rem" },
            { key: "date", label: "التاريخ", type: "date", editable: true, width: "8.5rem" },
            { key: "customerId", label: "العميل", type: "select", editable: true, options: customerOpts, create: "customer", width: "11rem" },
            { key: "description", label: "البند", editable: true, scope: "line", width: "14rem" },
            { key: "quantity", label: "الكمية", type: "number", editable: true, scope: "line", width: "5.5rem" },
            { key: "unitPrice", label: "السعر", type: "number", editable: true, scope: "line", width: "7rem" },
            { key: "vatRate", label: "الضريبة", type: "select", editable: true, scope: "line", options: [{ value: "15", label: "15%" }, { value: "0", label: "صفر" }], width: "5.5rem" },
            { key: "lineTotal", label: "إجمالي البند", type: "number", scope: "line", width: "7.5rem", calc: { multiply: ["quantity", "unitPrice"], vatPercent: "vatRate" } },
            { key: "routeId", label: "المسار", type: "select", editable: true, scope: "line", options: routeOpts, create: "route", width: "11rem" },
            { key: "validUntil", label: "صالح حتى", type: "date", editable: true, width: "8.5rem" },
            { key: "shippingType", label: "نوع الشحن", type: "select", editable: true, options: [{ value: "international", label: "دولي (صفري)" }, { value: "domestic", label: "داخلي (15%)" }], width: "8rem" },
            { key: "currency", label: "العملة", type: "select", editable: true, options: currencies.map((c) => ({ value: c.code, label: c.code })), width: "5rem" },
            { key: "reference", label: "المرجع", editable: true, width: "11rem" },
            { key: "total", label: "إجمالي العرض", type: "number", width: "7.5rem" },
            { key: "notes", label: "ملاحظات", editable: true, width: "14rem" },
          ]}
          rows={rows.map(({ q }): DocSheetRow => ({
            id: q.id,
            href: withParam(listUrl(), "edit", String(q.id)),
            editable: editable(q),
            cells: { number: q.number, date: q.quoteDate, validUntil: q.validUntil, customerId: String(q.customerId), shippingType: q.shippingType, currency: q.currencyCode, reference: q.reference, total: q.total, notes: q.notes },
            badges: { status: { label: QUOTE_STATUS[q.status].label, tone: QUOTE_STATUS[q.status].tone } },
            lines: (lineRows.get(q.id) ?? []).map((l) => ({
              id: l.id,
              cells: { routeId: l.routeId ? String(l.routeId) : "", description: l.description, quantity: String(Number(l.quantity)), unitPrice: String(Number(l.unitPrice)), vatRate: String(Number(l.vatRate)) },
            })),
          }))}
        />
      ) : openDoc ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,22rem)_1fr]">
          {/* القائمة المختصرة بجانب المعاينة */}
          <ul className="hidden max-h-[calc(100vh-9rem)] divide-y divide-gray-100 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm lg:sticky lg:top-4 lg:block print:hidden">
            {rows.map(({ q, customer }) => (
              <li key={q.id}>
                <Link
                  href={listUrl({ open: String(q.id) })}
                  scroll={false}
                  className={`block border-s-4 px-4 py-3 transition ${q.id === openId ? "border-brand-500 bg-brand-50/70" : "border-transparent hover:bg-gray-50"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-semibold text-gray-800">{customer}</span>
                    <span className="ltr-nums shrink-0 text-sm font-semibold text-brand-900">{fmt(q.total)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                    <span className="ltr-nums whitespace-nowrap">{q.number}</span>
                    <span className="text-gray-300">|</span>
                    <span className="ltr-nums whitespace-nowrap">{q.quoteDate}</span>
                    <span className="ms-auto">
                      <Badge tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Badge>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <section className="animate-flyout min-w-0 rounded-2xl bg-gray-100/70 shadow-inner">
            <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
              <Link href={listUrl()} scroll={false} aria-label="إغلاق المعاينة" title="إغلاق" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                <Icon name="close" className="size-4" />
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-semibold text-brand-900">
                    عرض سعر <span className="ltr-nums">{openDoc.q.number}</span>
                  </span>
                  <Badge tone={QUOTE_STATUS[openDoc.q.status].tone}>{QUOTE_STATUS[openDoc.q.status].label}</Badge>
                  {openDoc.q.status === "sent" && openDoc.q.validUntil < today && <Badge tone="red">منتهي الصلاحية</Badge>}
                </div>
                <div className="text-xs text-gray-500">
                  {openDoc.customer.nameAr} · {SHIPPING_TYPES[openDoc.q.shippingType].label}
                </div>
              </div>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                {editable(openDoc.q) && (
                  <Link href={withParam(listUrl({ open: String(openDoc.q.id) }), "edit", String(openDoc.q.id))} scroll={false} className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                    <Icon name="pencil" className="size-4" />
                    تعديل
                  </Link>
                )}
                <SendDocument kind="quotations" id={openDoc.q.id} label={`عرض سعر رقم ${openDoc.q.number}`} company={company.nameAr} phone={openDoc.customer.mobile} email={openDoc.customer.email} />
                <ActionsMenu items={menu(openDoc.q)} label="العمليات" />
              </div>
            </div>
            {openDoc.q.salesInvoiceId && (
              <p className="border-b border-green-100 bg-green-50 px-5 py-2 text-sm text-green-800">
                تحوّل هذا العرض إلى فاتورة؛ التعديل يكون على الفاتورة.{" "}
                <Link href={`/invoices?open=${openDoc.q.salesInvoiceId}`} className="font-semibold underline">
                  عرض الفاتورة
                </Link>
              </p>
            )}
            <div className="p-4 sm:p-6">
              <div className="mx-auto max-w-3xl">
                <QuotationDocument company={company} doc={openDoc} template={template} compact />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
          {(canUpdate || canDelete) && rows.length > 0 && (
            <ActionForm id={BULK_FORM} action={bulkQuotations} resetOnSuccess={false} className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
              <SelectionTotal form={BULK_FORM} noun="عرض" />
              <select name="op" required defaultValue="" aria-label="العملية على المحدد" className="h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm shadow-sm">
                <option value="" disabled>
                  اختر العملية…
                </option>
                {canUpdate && (
                  <optgroup label="تغيير الحالة إلى">
                    {Object.entries(QUOTE_STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {canDelete && <option value="delete">حذف المحدد</option>}
              </select>
              <SubmitButton variant="secondary">تنفيذ على المحدد</SubmitButton>
              <span className="ms-auto">
                <BulkPdfButton kind="quotations" ids={rows.map((r) => r.q.id)} />
              </span>
            </ActionForm>
          )}
          <Table head={[(canUpdate || canDelete) && rows.length ? <SelectAll key="all" form={BULK_FORM} /> : "", "الرقم", "التاريخ", "صالح حتى", "العميل", "نوع الشحن", "المرجع", "الإجمالي", "الحالة", "الفاتورة", ""]}>
            {rows.length === 0 && <EmptyRow cols={11}>{filter.q || filter.status || filter.from ? "لا توجد عروض بهذه الشروط" : "لا توجد عروض أسعار بعد؛ اضغط «إنشاء»"}</EmptyRow>}
            <LimitRow cols={11} shown={rows.length} limit={500} />
            {rows.map(({ q, customer, invoice }) => {
              const open = listUrl({ open: String(q.id) });
              const expired = q.status === "sent" && q.validUntil < today;
              return (
                <ClickRow key={q.id} href={open} className="transition hover:bg-brand-50/40">
                  <Td>{(canUpdate || canDelete) && <RowCheck form={BULK_FORM} id={q.id} amount={q.total} />}</Td>
                  <Td className="font-medium whitespace-nowrap">
                    <Link href={open} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                      {q.number}
                    </Link>
                  </Td>
                  <Td className="ltr-nums whitespace-nowrap">{q.quoteDate}</Td>
                  <Td className={`ltr-nums whitespace-nowrap ${expired ? "font-semibold text-red-600" : ""}`}>{q.validUntil}</Td>
                  <Td>
                    <Link href={open} scroll={false} className="hover:text-brand-700">
                      {customer}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{SHIPPING_TYPES[q.shippingType].short}</Td>
                  <Td className="max-w-48 truncate text-gray-600">{q.reference || "—"}</Td>
                  <Td className="ltr-nums font-semibold whitespace-nowrap">
                    {fmt(q.total)} <span className="text-xs font-normal text-gray-400">{q.currencyCode}</span>
                  </Td>
                  <Td>
                    <Badge tone={expired ? "red" : QUOTE_STATUS[q.status].tone}>{expired ? "منتهي الصلاحية" : QUOTE_STATUS[q.status].label}</Badge>
                  </Td>
                  <Td className="ltr-nums">
                    {invoice && q.salesInvoiceId ? (
                      <Link href={`/invoices?open=${q.salesInvoiceId}`} className="text-brand-700 hover:underline">
                        {invoice}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <Link href={open} scroll={false} aria-label="معاينة" title="معاينة بجانب القائمة" className="inline-flex rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-700">
                      <Icon name="expand" className="size-4" />
                    </Link>
                  </Td>
                </ClickRow>
              );
            })}
          </Table>
          {rows.length > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              إجمالي المعروض <span className="ltr-nums font-semibold text-gray-700">{fmt(total)}</span>
            </p>
          )}
        </>
      )}

      {initial && (
        <QuotationEditor
          key={editing ? `edit-${editId}` : "new"}
          title={editing ? `تعديل عرض السعر ${initial.number}` : "عرض سعر جديد"}
          initial={initial}
          customers={customerOpts}
          routes={routeOpts}
          currencies={currencies.map((c) => c.code)}
          company={company}
          template={template}
          action={saveQuotationPanel.bind(null, editing ? editId : null)}
          closeHref={back}
          savedHref={returnTo}
        />
      )}
    </>
  );
}
