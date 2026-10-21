import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listReceipts, receiptDoc, type ReceiptKind } from "@/lib/receipts";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { RECEIPT_KINDS, RECEIPT_STATUS } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { ImportLink } from "@/components/import-link";
import { ReceiptVoucher } from "@/components/receipt-voucher";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { NewReceiptMenu } from "./new-menu";
import { post, remove, revert } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BASE = "/receipts";
const KINDS = Object.fromEntries(Object.entries(RECEIPT_KINDS).map(([k, v]) => [k, v.label]));
const SORTS = { date_desc: "الأحدث أولاً", date_asc: "الأقدم أولاً", amount_desc: "الأعلى مبلغاً", amount_asc: "الأقل مبلغاً" } as const;

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<DocListParams> }) {
  const user = await requirePermission("receipts", "view");
  const sp = await searchParams;
  const canCreate = can(user.perms, "receipts", "create");
  const f = parseDocFilter(sp, Object.keys(KINDS), todayRiyadh());
  const openId = Number(sp.open) || null;
  const [list, openDoc, company, template] = await Promise.all([
    listReceipts(db, { q: f.q, from: f.from, to: f.to, kind: f.status as ReceiptKind | undefined, sort: f.sort in SORTS ? (f.sort as keyof typeof SORTS) : undefined }),
    openId ? receiptDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  const total = list.reduce((a, { r }) => a + (r.kind === "refund" ? -1 : 1) * Number(r.amount) * Number(r.exchangeRate), 0);

  const amountCell = (r: (typeof list)[number]["r"]) => (
    <span className={`ltr-nums font-semibold whitespace-nowrap ${r.kind === "refund" ? "text-amber-700" : "text-emerald-700"}`}>
      {r.kind === "refund" ? "−" : ""}
      {fmt(r.amount)} <span className="text-[10px] font-normal text-gray-400">{r.currencyCode}</span>
    </span>
  );
  const kindCell = (r: (typeof list)[number]["r"], count: number) => (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Badge tone={RECEIPT_KINDS[r.kind].tone}>{RECEIPT_KINDS[r.kind].short}</Badge>
      {count > 0 && (
        <span className="ltr-nums rounded bg-sky-100 px-1.5 text-[11px] font-semibold text-sky-800" title="عدد الفواتير">
          {count}
        </span>
      )}
    </span>
  );

  return (
    <>
      <PageHeader title="سندات العملاء" description="سندات القبض عن الفواتير، والدفعات المقدمة، وسندات الاسترداد. اضغط السند لمعاينته وطباعته.">
        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            <ImportLink entity="receipts" />
            <NewReceiptMenu />
          </div>
        )}
      </PageHeader>

      <DocToolbar
        base={BASE}
        params={sp}
        statuses={KINDS}
        allStatuses="كل الأنواع"
        pay={false}
        views={false}
        sorts={SORTS}
        noun="سند"
        exportName="سندات-العملاء"
        count={list.length}
      />
      <div className="mb-2 flex justify-end">
        <BulkPdfButton kind="receipts" ids={list.map((x) => x.r.id)} />
      </div>

      {openDoc ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,22rem)_1fr]">
          <ul className="hidden max-h-[calc(100vh-9rem)] lg:block divide-y divide-gray-100 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm print:hidden lg:sticky lg:top-4">
            {list.map(({ r, customer, invoiceCount }) => (
              <li key={r.id}>
                <Link
                  href={listHref(BASE, sp, { open: String(r.id) })}
                  scroll={false}
                  className={`block border-s-4 px-4 py-3 transition ${r.id === openId ? "border-brand-500 bg-brand-50/70" : "border-transparent hover:bg-gray-50"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-semibold text-gray-800">{customer}</span>
                    {amountCell(r)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                    <span className="ltr-nums">{r.number}</span>
                    <span className="text-gray-300">|</span>
                    <span className="ltr-nums">{r.receiptDate}</span>
                    <span className="ms-auto">{kindCell(r, invoiceCount)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <section className="animate-flyout min-w-0 rounded-2xl bg-gray-100/70 shadow-inner">
            <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
              <Link href={listHref(BASE, sp, { open: undefined })} scroll={false} aria-label="إغلاق المعاينة" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                <Icon name="close" className="size-4" />
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-semibold text-brand-900">
                    {RECEIPT_KINDS[openDoc.r.kind].label} <span className="ltr-nums">{openDoc.r.number}</span>
                  </span>
                  <Badge tone={RECEIPT_STATUS[openDoc.r.status].tone}>{RECEIPT_STATUS[openDoc.r.status].label}</Badge>
                </div>
                <div className="text-xs text-gray-500">{openDoc.customer.nameAr}</div>
              </div>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <Link href={`/receipts/${openDoc.r.id}?print=1`} target="_blank" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                  طباعة
                </Link>
                {openDoc.r.kind === "advance" && openDoc.r.status === "posted" && canCreate && (
                  <Link href={`/receipts/${openDoc.r.id}/apply`} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                    تطبيق على فواتير
                  </Link>
                )}
                {openDoc.r.status === "draft" && can(user.perms, "receipts", "approve") && (
                  <ActionForm action={post.bind(null, openDoc.r.id)} resetOnSuccess={false}>
                    <SubmitButton>ترحيل</SubmitButton>
                  </ActionForm>
                )}
                {openDoc.r.status === "posted" && can(user.perms, "receipts", "revert") && (
                  <ActionForm action={revert.bind(null, openDoc.r.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">إرجاع لمسودة</SubmitButton>
                  </ActionForm>
                )}
                {openDoc.r.status === "draft" && can(user.perms, "receipts", "delete") && (
                  <ActionForm action={remove.bind(null, openDoc.r.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">حذف</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
            <div className="p-4 sm:p-6">
              <div className="mx-auto max-w-3xl">
                <ReceiptVoucher company={company} doc={openDoc} template={template} compact />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
          <Table head={["التاريخ", "الرقم", "العميل", "النوع", "إلى / من", "المبلغ", "الحالة"]}>
            {list.length === 0 && <EmptyRow cols={7}>{f.q || f.status || f.from ? "لا توجد سندات بهذه الشروط" : "لا توجد سندات بعد"}</EmptyRow>}
            {list.map(({ r, customer, account, invoiceCount, allocated }) => {
              const open = listHref(BASE, sp, { open: String(r.id) });
              const left = r.status === "posted" && r.kind !== "refund" ? Number(r.amount) - Number(allocated) : 0;
              return (
                <tr key={r.id} className="transition hover:bg-brand-50/40">
                  <Td className="ltr-nums whitespace-nowrap">{r.receiptDate}</Td>
                  <Td className="font-medium whitespace-nowrap">
                    <Link href={open} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                      {r.number}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={open} scroll={false} className="hover:text-brand-700">
                      {customer}
                    </Link>
                  </Td>
                  <Td>
                    {kindCell(r, invoiceCount)}
                    {left > 0.005 && <div className="ltr-nums mt-1 text-[11px] text-amber-700">غير مطبق {fmt(left)}</div>}
                  </Td>
                  <Td className="text-xs text-gray-600">{account}</Td>
                  <Td>{amountCell(r)}</Td>
                  <Td>
                    <Badge tone={RECEIPT_STATUS[r.status].tone}>{RECEIPT_STATUS[r.status].label}</Badge>
                  </Td>
                </tr>
              );
            })}
          </Table>
          {list.length > 0 && (
            <div className="mt-2 text-end text-xs text-gray-500">
              صافي المحصّل بالريال: <span className="ltr-nums font-semibold text-gray-800">{fmt(total)}</span>
            </div>
          )}
        </>
      )}
    </>
  );
}
