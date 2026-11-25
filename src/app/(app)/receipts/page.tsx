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
import { Badge, EmptyRow, PageHeader, Pager, Table, Td } from "@/components/ui";
import { PAGE_SIZE, pageOf } from "@/lib/paging";
import { DocCard, DocCards, SheetFacts, SheetMoney, sheetBtn, sheetPrimary } from "@/components/doc-card";
import { MobileSheet } from "@/components/mobile-sheet";
import { ClickRow } from "@/components/click-row";
import type { MenuItem } from "@/components/actions-menu";
import { EdgeCell, NextStepCell, NumDateCell, StatusCell, StatusTabs, Sub } from "@/components/desk-list";
import { DeskDrawer } from "@/components/desk-drawer";
import { NewReceiptMenu } from "./new-menu";
import { post, remove, revert } from "./actions";
import { fmt, fmtDate } from "@/lib/format";

const BASE = "/receipts";
const drawerBtn = "inline-flex h-10 items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm hover:bg-gray-50";
const KINDS = Object.fromEntries(Object.entries(RECEIPT_KINDS).map(([k, v]) => [k, v.label]));
const SORTS = { date_desc: "الأحدث أولاً", date_asc: "الأقدم أولاً", amount_desc: "الأعلى مبلغاً", amount_asc: "الأقل مبلغاً" } as const;

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<DocListParams> }) {
  const user = await requirePermission("receipts", "view");
  const sp = await searchParams;
  const canCreate = can(user.perms, "receipts", "create");
  const f = parseDocFilter(sp, Object.keys(KINDS), todayRiyadh());
  const openId = Number(sp.open) || null;
  const { page, offset } = pageOf(sp.page);
  const [list, openDoc, company, template] = await Promise.all([
    listReceipts(db, { q: f.q, from: f.from, to: f.to, kind: f.status as ReceiptKind | undefined, sort: f.sort in SORTS ? (f.sort as keyof typeof SORTS) : undefined }, PAGE_SIZE, offset),
    openId ? receiptDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  // أزرار الأنواع بعددها: عند تصفية نوع يُعدّ الباقي من القائمة دون تصفية النوع
  // (سطر واحد يكفي: أعمدة العدد محسوبة على كل السندات)
  const all = (f.status ? await listReceipts(db, { q: f.q, from: f.from, to: f.to }, 1) : list)[0];
  const kindCounts: Record<string, number> = { invoice_payment: all?.nInvoice ?? 0, advance: all?.nAdvance ?? 0, refund: all?.nRefund ?? 0 };
  const total = list[0]?.sumSar ?? 0;
  const rowsTotal = list[0]?.n ?? 0;

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

  const canPost = can(user.perms, "receipts", "approve");
  /** زر «الخطوة التالية» في صف الكمبيوتر */
  const rowNext = (r: (typeof list)[number]["r"], left: number): { item?: MenuItem; go?: boolean; note?: string } => {
    if (r.status === "draft") return canPost ? { item: { label: "رحّله", action: post.bind(null, r.id) }, go: true } : { note: "ينتظر الترحيل" };
    if (r.status !== "posted") return {};
    if (r.kind === "advance" && left > 0.005 && canCreate) return { item: { label: "طبّقه على فواتير", href: `/receipts/${r.id}/apply` }, go: true };
    return { note: "اكتمل" };
  };

  // الجوال: بطاقة لكل سند بنفس شكل بطاقة الشحنة (قرار أحمد 2026-11-22)
  const mobileList = (
    <DocCards empty={f.q || f.status || f.from ? "لا توجد سندات بهذه الشروط" : "لا توجد سندات بعد"}>
      {list.map(({ r, customer, account, invoiceCount, allocated }) => {
        const left = r.status === "posted" && r.kind !== "refund" ? Number(r.amount) - Number(allocated) : 0;
        return (
          <DocCard
            key={r.id}
            href={listHref(BASE, sp, { open: String(r.id) })}
            number={r.number}
            status={{ label: RECEIPT_STATUS[r.status].label, tone: RECEIPT_STATUS[r.status].tone }}
            extraBadge={{ label: RECEIPT_KINDS[r.kind].short, tone: RECEIPT_KINDS[r.kind].tone }}
            date={r.receiptDate}
            party={customer}
            meta={
              <>
                <span className="min-w-0 truncate">{account}</span>
                {invoiceCount > 0 && <span className="shrink-0">{invoiceCount === 1 ? "فاتورة واحدة" : `${invoiceCount} فواتير`}</span>}
              </>
            }
            amount={`${r.kind === "refund" ? "−" : ""}${fmt(r.amount)}`}
            currency={r.currencyCode}
            next={r.status === "draft" ? "رحّله" : left > 0.005 ? `غير مطبق ${fmt(left)}` : null}
            active={r.id === openId}
          />
        );
      })}
    </DocCards>
  );
  const closeHref = listHref(BASE, sp, { open: undefined });
  const mobileSheet = openDoc && (
    <MobileSheet
      closeHref={closeHref}
      label={`معاينة السند ${openDoc.r.number}`}
      header={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="ltr-nums font-display text-[17px] font-semibold text-brand-900">{openDoc.r.number}</span>
            <Badge tone={RECEIPT_STATUS[openDoc.r.status].tone}>{RECEIPT_STATUS[openDoc.r.status].label}</Badge>
          </div>
          <p className="mt-1 truncate text-[13px] text-gray-600">
            {RECEIPT_KINDS[openDoc.r.kind].label} · {openDoc.customer.nameAr}
          </p>
        </>
      }
      footer={
        <>
          {openDoc.r.status === "draft" && can(user.perms, "receipts", "approve") && (
            <ActionForm action={post.bind(null, openDoc.r.id)} resetOnSuccess={false} className="col-span-2">
              <SubmitButton pendingLabel="جارٍ الترحيل…" className={`w-full ${sheetPrimary}`}>
                ترحيل
              </SubmitButton>
            </ActionForm>
          )}
          {openDoc.r.kind === "advance" && openDoc.r.status === "posted" && canCreate && (
            <Link href={`/receipts/${openDoc.r.id}/apply`} className={sheetPrimary}>
              تطبيق على فواتير
            </Link>
          )}
          <Link href={`/receipts/${openDoc.r.id}`} className={sheetBtn}>
            <Icon name="expand" className="size-4" />
            فتح كاملة
          </Link>
          <Link href={`/receipts/${openDoc.r.id}?print=1`} target="_blank" className={sheetBtn}>
            <Icon name="printer" className="size-4" />
            طباعة
          </Link>
        </>
      }
    >
      <SheetFacts
        items={[
          ["التاريخ", <span key="d" className="ltr-nums">{fmtDate(openDoc.r.receiptDate)}</span>],
          ["النوع", RECEIPT_KINDS[openDoc.r.kind].label],
          ["العملة", openDoc.r.currencyCode],
          ["سعر الصرف", <span key="x" className="ltr-nums">{openDoc.r.exchangeRate}</span>],
        ]}
      />
      <SheetMoney lines={[]} total={["المبلغ", `${openDoc.r.kind === "refund" ? "−" : ""}${fmt(openDoc.r.amount)} ${openDoc.r.currencyCode}`]} />
    </MobileSheet>
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

      <StatusTabs
        label="نوع السند"
        tabs={[{ key: "", label: "الكل" }, ...Object.entries(KINDS).map(([key, label]) => ({ key, label }))].map((t) => ({
          ...t,
          href: listHref(BASE, sp, { status: t.key || undefined, open: undefined, page: undefined }),
          count: t.key ? kindCounts[t.key] ?? 0 : all?.n ?? 0,
          active: (f.status ?? "") === t.key,
        }))}
        summary={
          list.length > 0 ? (
            <>
              صافي المحصّل بالريال <b className="ltr-nums font-display text-sm font-semibold text-asphalt-900">{fmt(total)}</b>
            </>
          ) : null
        }
      />
      <DocToolbar
        base={BASE}
        params={sp}
        statuses={{}}
        pay={false}
        views={false}
        sorts={SORTS}
        noun="سند"
        exportName="سندات-العملاء"
        count={rowsTotal}
        extra={
          list.length > 0 ? (
            <span className="max-md:hidden">
              <BulkPdfButton kind="receipts" ids={list.map((x) => x.r.id)} />
            </span>
          ) : null
        }
      />

      {mobileList}
      {mobileSheet}
      <div className="max-md:hidden">
        <Table head={["السند", "العميل والحساب", "النوع", "المبلغ", "الحالة", "الخطوة التالية", ""]}>
          {list.length === 0 && <EmptyRow cols={7}>{f.q || f.status || f.from ? "لا توجد سندات بهذه الشروط" : "لا توجد سندات بعد"}</EmptyRow>}
          {list.map(({ r, customer, account, invoiceCount, allocated }) => {
            const open = listHref(BASE, sp, { open: String(r.id) });
            const left = r.status === "posted" && r.kind !== "refund" ? Number(r.amount) - Number(allocated) : 0;
            const st = RECEIPT_STATUS[r.status];
            return (
              <ClickRow key={r.id} href={open} className={`transition hover:bg-brand-50/40 ${r.id === openId ? "bg-brand-50/70" : ""}`}>
                <NumDateCell number={r.number} date={r.receiptDate} href={open} />
                <Td>
                  <span className="font-medium text-gray-800">{customer}</span>
                  <Sub className="max-w-64 truncate">{account}</Sub>
                </Td>
                <Td>
                  {kindCell(r, invoiceCount)}
                  {left > 0.005 && <Sub className="ltr-nums !text-amber-700">غير مطبق {fmt(left)}</Sub>}
                </Td>
                <Td>{amountCell(r)}</Td>
                <StatusCell status={st} />
                <NextStepCell {...rowNext(r, left)} />
                <EdgeCell tone={r.status === "posted" && left > 0.005 ? "amber" : st.tone} />
              </ClickRow>
            );
          })}
        </Table>
      </div>
      <Pager page={page} size={PAGE_SIZE} total={rowsTotal} hrefFor={(p) => listHref(BASE, sp, { page: p > 1 ? String(p) : undefined, open: undefined })} />
      {openDoc && (
        <DeskDrawer
          closeHref={closeHref}
          label={`معاينة السند ${openDoc.r.number}`}
          header={
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-semibold text-brand-900">
                  {RECEIPT_KINDS[openDoc.r.kind].label} <span className="ltr-nums">{openDoc.r.number}</span>
                </span>
                <Badge tone={RECEIPT_STATUS[openDoc.r.status].tone}>{RECEIPT_STATUS[openDoc.r.status].label}</Badge>
              </div>
              <p className="mt-0.5 truncate text-sm text-gray-600">{openDoc.customer.nameAr}</p>
            </>
          }
          footer={
            <>
              {openDoc.r.status === "draft" && can(user.perms, "receipts", "approve") && (
                <ActionForm action={post.bind(null, openDoc.r.id)} resetOnSuccess={false}>
                  <SubmitButton pendingLabel="جارٍ الترحيل…">ترحيل</SubmitButton>
                </ActionForm>
              )}
              {openDoc.r.kind === "advance" && openDoc.r.status === "posted" && canCreate && (
                <Link href={`/receipts/${openDoc.r.id}/apply`} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
                  تطبيق على فواتير
                </Link>
              )}
              <Link href={`/receipts/${openDoc.r.id}`} className={drawerBtn}>
                <Icon name="expand" className="size-4" />
                فتح كاملة
              </Link>
              <Link href={`/receipts/${openDoc.r.id}?print=1`} target="_blank" className={drawerBtn}>
                <Icon name="printer" className="size-4" />
                طباعة
              </Link>
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
            </>
          }
        >
          <SheetFacts
            items={[
              ["التاريخ", <span key="d" className="ltr-nums">{fmtDate(openDoc.r.receiptDate)}</span>],
              ["النوع", RECEIPT_KINDS[openDoc.r.kind].label],
              ["العملة", openDoc.r.currencyCode],
              ["سعر الصرف", <span key="x" className="ltr-nums">{openDoc.r.exchangeRate}</span>],
            ]}
          />
          <SheetMoney lines={[]} total={["المبلغ", `${openDoc.r.kind === "refund" ? "−" : ""}${fmt(openDoc.r.amount)} ${openDoc.r.currencyCode}`]} />
          <div className="mt-5 rounded-2xl bg-gray-100/70 p-3 shadow-inner">
            <ReceiptVoucher company={company} doc={openDoc} template={template} compact />
          </div>
        </DeskDrawer>
      )}
    </>
  );
}
