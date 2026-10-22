import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { productOptions } from "@/lib/inventory";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { vehicleOptions } from "@/lib/lookups";
import { expenseAccountOptions, listPurchaseInvoices, purchaseInvoiceDoc, supplierOptions } from "@/lib/purchases";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { PURCHASE_STATUS } from "@/data/purchases";
import { paymentState } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { PurchaseInvoiceDocument } from "@/components/purchase-invoice";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { post, postMany, savePurchaseSheet, savePurchases } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BASE = "/purchases";
const POST_FORM = "post-purchases";
const STATUSES = { draft: PURCHASE_STATUS.draft.label, posted: PURCHASE_STATUS.posted.label };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<DocListParams> }) {
  const user = await requirePermission("purchase_invoices", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const canCreate = can(user.perms, "purchase_invoices", "create");
  const canPost = can(user.perms, "purchase_invoices", "approve");
  const filter = parseDocFilter(sp, Object.keys(STATUSES), today);
  const view = sp.view === "sheet" ? "sheet" : "table";
  const openId = view === "table" ? Number(sp.open) || null : null;
  const [suppliers, accounts, vehicles, list, openDoc, products, warehouses] = await Promise.all([
    canCreate ? supplierOptions(db) : Promise.resolve([]),
    canCreate ? expenseAccountOptions(db) : Promise.resolve([]),
    canCreate ? vehicleOptions() : Promise.resolve([]),
    listPurchaseInvoices(db, filter),
    openId ? purchaseInvoiceDoc(db, openId) : Promise.resolve(null),
    canCreate ? productOptions(db).then((r) => r.map((p) => ({ value: String(p.id), label: `${p.code} ${p.nameAr}` }))) : Promise.resolve([]),
    canCreate ? db.select({ id: s.warehouses.id, nameAr: s.warehouses.nameAr }).from(s.warehouses).where(eq(s.warehouses.isActive, true)).then((r) => r.map((w) => ({ value: String(w.id), label: w.nameAr }))) : Promise.resolve([]),
  ]);

  const state = (i: (typeof list)[number]["i"]) => {
    const total = Number(i.total);
    const paid = Number(i.paidAmount);
    const overdue = i.status === "posted" && paid < total && i.dueDate < today;
    const pay = paymentState(total, paid);
    return { total, paid, overdue, pay: i.status === "posted" ? (overdue ? { label: "متأخرة", tone: "red" as const } : pay) : null };
  };
  const drafts = list.filter(({ i }) => i.status === "draft");

  return (
    <>
      <PageHeader title="فواتير الموردين" description="مشتريات الصيانة وقطع الغيار والإطارات والخدمات. كل سطر على حسابه ومركبته، وضريبة المدخلات تُسترد تلقائياً." />

      {canCreate && (
        <details open={!list.length && !filter.q && !filter.status} className="group mb-5 rounded-2xl border border-brand-500/30 bg-brand-50/60 print:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500 text-lg leading-none font-bold text-brand-900">+</span>
            <span className="font-semibold text-brand-900">إدخال فواتير موردين</span>
            <span className="text-xs text-gray-500">بطريقة الورقة، أو الصقها من Excel</span>
            <span className="ms-auto text-xs text-gray-500 group-open:hidden">فتح</span>
          </summary>
          <div className="px-5 pb-4">
            {suppliers.length === 0 ? (
              <p className="text-sm text-gray-500">
                أضف الموردين والورش من{" "}
                <Link href="/parties" className="text-brand-700 underline">
                  جهات الاتصال
                </Link>{" "}
                أولاً.
              </p>
            ) : (
              <>
                <SheetEditor
                  templateName="فواتير الموردين"
                  action={savePurchases}
                  initialRows={4}
                  columns={[
                    { key: "date", label: "التاريخ", type: "date", required: true, placeholder: today },
                    { key: "supplierId", label: "المورد", type: "select", required: true, options: suppliers, width: "11rem" },
                    { key: "supplierInvoiceNo", label: "رقم فاتورته", required: true, ltr: true, width: "7rem" },
                    { key: "productId", label: "الصنف", type: "select", options: products, width: "11rem" },
                    { key: "warehouseId", label: "المستودع", type: "select", options: warehouses, width: "8rem" },
                    { key: "quantity", label: "الكمية", type: "number", width: "5rem" },
                    { key: "accountId", label: "الحساب", type: "select", options: accounts, width: "14rem", placeholder: "حساب الصنف" },
                    { key: "vehicleId", label: "المركبة", type: "select", options: vehicles, width: "8rem" },
                    { key: "description", label: "البيان", width: "12rem" },
                    { key: "amount", label: "المبلغ قبل الضريبة", type: "number", required: true, width: "7rem" },
                    { key: "vat", label: "الضريبة", type: "select", options: [{ value: "15", label: "15%" }, { value: "0", label: "بدون" }], width: "5rem", placeholder: "15%" },
                    { key: "dueDate", label: "الاستحقاق", type: "date", placeholder: "بعد 30 يوماً" },
                    { key: "currency", label: "العملة", type: "select", options: [{ value: "SAR", label: "SAR" }, { value: "KWD", label: "KWD" }], width: "5rem", placeholder: "SAR" },
                  ]}
                />
                <p className="mt-2 text-xs text-gray-500">
                  الصفوف التي لها نفس المورد ورقم الفاتورة تُحفظ فاتورة واحدة بعدة سطور. حساب الذمة يُحدد من دور الجهة (مورد، ورشة، محطة، ناقل، مخلص). تكاليف الناقلين والديزل الآجل المسجلة على الشحنات لا تُدخل هنا مرة ثانية؛ تُسدد مباشرة من{" "}
                  <Link href="/payments" className="text-brand-700 underline">
                    سندات الصرف
                  </Link>
                  .
                </p>
              </>
            )}
          </div>
        </details>
      )}

      <DocToolbar base={BASE} params={sp} statuses={STATUSES} exportName="فواتير-الموردين" count={list.length} />
      <div className="mb-2 flex justify-end">
        <BulkPdfButton kind="purchases" ids={list.map((x) => x.i.id)} />
      </div>

      {view === "sheet" ? (
        <DocSheet
          action={savePurchaseSheet}
          emptyText="لا توجد فواتير بهذه الشروط"
          columns={[
            { key: "status", label: "الحالة", type: "badge", width: "5.5rem" },
            { key: "number", label: "الرقم", ltr: true, width: "7.5rem" },
            { key: "supplier", label: "المورد", width: "12rem" },
            { key: "supplierInvoiceNo", label: "رقم فاتورته", editable: true, ltr: true, width: "8rem" },
            { key: "invoiceDate", label: "التاريخ", type: "date", editable: true, width: "8.5rem" },
            { key: "dueDate", label: "الاستحقاق", type: "date", editable: true, width: "8.5rem" },
            { key: "description", label: "البيان", width: "13rem" },
            { key: "currency", label: "العملة", width: "4rem" },
            { key: "subtotal", label: "قبل الضريبة", type: "number", width: "7rem" },
            { key: "vat", label: "الضريبة", type: "number", width: "6rem" },
            { key: "total", label: "الإجمالي", type: "number", width: "7rem" },
            { key: "due", label: "المتبقي", type: "number", width: "6.5rem" },
            { key: "pay", label: "السداد", type: "badge", width: "6rem" },
            { key: "notes", label: "ملاحظات", editable: true, width: "14rem" },
          ]}
          rows={list.map(({ i, supplier, lines, firstLine }): DocSheetRow => {
            const st = state(i);
            return {
              id: i.id,
              href: `/purchases/${i.id}`,
              editable: i.status === "draft" && can(user.perms, "purchase_invoices", "update"),
              cells: {
                number: i.number,
                supplier,
                supplierInvoiceNo: i.supplierInvoiceNo,
                invoiceDate: i.invoiceDate,
                dueDate: i.dueDate,
                description: lines > 1 ? `${firstLine ?? ""} (+${lines - 1})` : firstLine,
                currency: i.currencyCode,
                subtotal: i.subtotal,
                vat: i.vatTotal,
                total: i.total,
                due: String(st.total - st.paid),
                notes: i.notes,
              },
              badges: {
                status: { label: PURCHASE_STATUS[i.status].label, tone: PURCHASE_STATUS[i.status].tone },
                ...(st.pay ? { pay: st.pay } : {}),
              },
            };
          })}
        />
      ) : openDoc ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,22rem)_1fr]">
          <ul className="hidden max-h-[calc(100vh-9rem)] lg:block divide-y divide-gray-100 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm print:hidden lg:sticky lg:top-4">
            {list.map(({ i, supplier }) => {
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
                      <span className="line-clamp-1 text-sm font-semibold text-gray-800">{supplier}</span>
                      <span className="ltr-nums shrink-0 text-sm font-semibold text-brand-900">{fmt(st.total)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                      <span className="ltr-nums whitespace-nowrap">{i.supplierInvoiceNo}</span>
                      <span className="text-gray-300">|</span>
                      <span className="ltr-nums whitespace-nowrap">{i.invoiceDate}</span>
                      <span className="ms-auto flex gap-1">
                        <Badge tone={PURCHASE_STATUS[i.status].tone}>{PURCHASE_STATUS[i.status].label}</Badge>
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
                <span className="font-display text-lg font-semibold text-brand-900">
                  فاتورة المورد <span className="ltr-nums">{openDoc.i.number}</span>
                </span>
                <div className="text-xs text-gray-500">{openDoc.supplier.nameAr}</div>
              </div>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <Link href={`/print/purchases?ids=${openDoc.i.id}`} target="_blank" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                  طباعة
                </Link>
                <Link href={`/purchases/${openDoc.i.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                  فتح الفاتورة
                </Link>
                {openDoc.i.status === "posted" && canCreate && (
                  <Link href={`/notes/purchase/new?kind=purchase_debit&party=${openDoc.i.supplierId}&invoice=${openDoc.i.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                    إشعار مدين (مرتجع)
                  </Link>
                )}
                {openDoc.i.status === "draft" && canPost && (
                  <ActionForm action={post.bind(null, openDoc.i.id)} resetOnSuccess={false}>
                    <SubmitButton>ترحيل القيد</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
            <div className="p-4 sm:p-6">
              <div className="mx-auto max-w-3xl">
                <PurchaseInvoiceDocument doc={openDoc} />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
          {canPost && drafts.length > 0 && (
            <ActionForm id={POST_FORM} action={postMany} className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
              <SelectionTotal form={POST_FORM} noun="فاتورة" />
              <SubmitButton variant="secondary">ترحيل المحدد</SubmitButton>
              <span className="text-xs text-gray-400">حدد المسودات من الجدول؛ تُرحّل كل فاتورة بقيدها.</span>
            </ActionForm>
          )}
          <Table head={[canPost && drafts.length ? <SelectAll key="all" form={POST_FORM} /> : "", "الرقم", "التاريخ", "المورد", "رقم فاتورته", "الإجمالي", "المتبقي", "الاستحقاق", "الحالة", "السداد", ""]}>
            {list.length === 0 && <EmptyRow cols={11}>{filter.q || filter.status || filter.pay || filter.from ? "لا توجد فواتير بهذه الشروط" : "لا توجد فواتير موردين بعد"}</EmptyRow>}
            {list.map(({ i, supplier }) => {
              const st = state(i);
              const open = listHref(BASE, sp, { open: String(i.id) });
              return (
                <tr key={i.id} className="transition hover:bg-brand-50/40">
                  <Td>{canPost && i.status === "draft" && <RowCheck form={POST_FORM} id={i.id} amount={i.total} />}</Td>
                  <Td className="font-medium whitespace-nowrap">
                    <Link href={open} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                      {i.number}
                    </Link>
                  </Td>
                  <Td className="ltr-nums whitespace-nowrap">{i.invoiceDate}</Td>
                  <Td>
                    <Link href={open} scroll={false} className="hover:text-brand-700">
                      {supplier}
                    </Link>
                  </Td>
                  <Td className="ltr-nums">{i.supplierInvoiceNo}</Td>
                  <Td className="ltr-nums font-semibold whitespace-nowrap">
                    {fmt(st.total)} <span className="text-xs font-normal text-gray-400">{i.currencyCode}</span>
                  </Td>
                  <Td className="ltr-nums">{fmt(st.total - st.paid)}</Td>
                  <Td className={`ltr-nums whitespace-nowrap ${st.overdue ? "font-semibold text-red-600" : ""}`}>{i.dueDate}</Td>
                  <Td>
                    <Badge tone={PURCHASE_STATUS[i.status].tone}>{PURCHASE_STATUS[i.status].label}</Badge>
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
        </>
      )}
    </>
  );
}
