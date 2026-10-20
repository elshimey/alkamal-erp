import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { entryDoc, listEntries, type EntryFilter } from "@/lib/journal";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { ENTRY_KINDS, ENTRY_SOURCES, ENTRY_STATUS } from "@/data/journal";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { ImportLink } from "@/components/import-link";
import { JournalVoucher } from "@/components/journal-voucher";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { post, remove, revert } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SORTS = { date_desc: "الأحدث أولاً", date_asc: "الأقدم أولاً", amount_desc: "الأعلى مبلغاً", amount_asc: "الأقل مبلغاً" } as const;
const BASE = "/journal";
const btn = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50";

export default async function JournalPage({ searchParams }: { searchParams: Promise<DocListParams> }) {
  const user = await requirePermission("journal_entries", "view");
  const sp = await searchParams;
  const f = parseDocFilter(sp, Object.keys(ENTRY_KINDS), todayRiyadh());
  const openId = Number(sp.open) || null;
  const [list, openDoc, company, template] = await Promise.all([
    listEntries(db, { q: f.q, from: f.from, to: f.to, kind: f.status as EntryFilter["kind"], sort: f.sort in SORTS ? (f.sort as keyof typeof SORTS) : undefined }),
    openId ? entryDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  const canCreate = can(user.perms, "journal_entries", "create");
  const sourceCell = (e: (typeof list)[number]["e"]) =>
    e.sourceType ? <span className="text-xs text-gray-500">{ENTRY_SOURCES[e.sourceType]?.label ?? e.sourceType}</span> : <Badge tone="amber">يدوي</Badge>;

  return (
    <>
      <PageHeader title="القيود اليومية" description="كل قيود الدفاتر: اليدوية التي تنشئها هنا، والآلية من الفواتير والسندات والبوالص. اضغط القيد لمعاينته وطباعته.">
        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/journal/reclassify" className={btn}>
              إعادة تصنيف جماعي
            </Link>
            <ImportLink entity="journal-entries" />
            <Link href="/journal/new" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
              + قيد جديد
            </Link>
          </div>
        )}
      </PageHeader>

      <DocToolbar base={BASE} params={sp} statuses={ENTRY_KINDS} allStatuses="كل القيود" pay={false} views={false} sorts={SORTS} noun="قيد" exportName="القيود-اليومية" count={list.length} placeholder="ابحث بالرقم أو الوصف أو الحساب" />

      {openDoc ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,22rem)_1fr]">
          <ul className="max-h-[calc(100vh-9rem)] divide-y divide-gray-100 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm print:hidden lg:sticky lg:top-4">
            {list.map(({ e, total }) => (
              <li key={e.id}>
                <Link href={listHref(BASE, sp, { open: String(e.id) })} scroll={false} className={`block border-s-4 px-4 py-3 transition ${e.id === openId ? "border-brand-500 bg-brand-50/70" : "border-transparent hover:bg-gray-50"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-semibold text-gray-800">{e.description || "—"}</span>
                    <span className="ltr-nums text-sm font-semibold whitespace-nowrap">{fmt(total)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    <span className="ltr-nums">{e.number}</span>
                    <span className="ltr-nums">{e.entryDate}</span>
                    <span className="ms-auto">{sourceCell(e)}</span>
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
              <div className="flex items-center gap-2">
                <span className="ltr-nums font-display text-lg font-semibold text-brand-900">{openDoc.e.number}</span>
                <Badge tone={ENTRY_STATUS[openDoc.e.status].tone}>{ENTRY_STATUS[openDoc.e.status].label}</Badge>
              </div>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <Link href={`/journal/${openDoc.e.id}?print=1`} target="_blank" className={btn}>
                  طباعة
                </Link>
                {canCreate && (
                  <Link href={`/journal/new?copy=${openDoc.e.id}`} className={btn}>
                    نسخ
                  </Link>
                )}
                {!openDoc.e.sourceType && openDoc.e.status !== "posted" && can(user.perms, "journal_entries", "update") && (
                  <Link href={`/journal/${openDoc.e.id}/edit`} className={btn}>
                    تعديل
                  </Link>
                )}
                {!openDoc.e.sourceType && openDoc.e.status !== "posted" && can(user.perms, "journal_entries", "approve") && (
                  <ActionForm action={post.bind(null, openDoc.e.id)} resetOnSuccess={false}>
                    <SubmitButton>ترحيل</SubmitButton>
                  </ActionForm>
                )}
                {!openDoc.e.sourceType && openDoc.e.status === "posted" && can(user.perms, "journal_entries", "revert") && (
                  <ActionForm action={revert.bind(null, openDoc.e.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">إرجاع لمسودة</SubmitButton>
                  </ActionForm>
                )}
                {!openDoc.e.sourceType && openDoc.e.status !== "posted" && can(user.perms, "journal_entries", "delete") && (
                  <ActionForm action={remove.bind(null, openDoc.e.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">حذف</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
            <div className="p-4 sm:p-6">
              <div className="mx-auto max-w-4xl">
                <JournalVoucher company={company} doc={openDoc} template={template} compact />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
          <div className="mb-2 flex justify-end">
            <BulkPdfButton kind="journal" ids={list.map((x) => x.e.id)} label="تصدير القيود PDF (ملف مضغوط)" />
          </div>
          <Table head={["التاريخ", "الرقم", "الوصف", "المصدر", "المرجع", "السطور", "المبلغ", "الحالة"]}>
            {list.length === 0 && <EmptyRow cols={8}>{f.q || f.status || f.from ? "لا توجد قيود بهذه الشروط" : "لا توجد قيود بعد"}</EmptyRow>}
            {list.map(({ e, total, lines }) => {
              const open = listHref(BASE, sp, { open: String(e.id) });
              return (
                <tr key={e.id} className="transition hover:bg-brand-50/40">
                  <Td className="ltr-nums whitespace-nowrap">{e.entryDate}</Td>
                  <Td className="whitespace-nowrap">
                    <Link href={open} scroll={false} className="ltr-nums font-medium text-brand-700 hover:underline">
                      {e.number}
                    </Link>
                  </Td>
                  <Td className="max-w-80">
                    <Link href={open} scroll={false} className="line-clamp-1 hover:text-brand-700">
                      {e.description || "—"}
                    </Link>
                  </Td>
                  <Td>{sourceCell(e)}</Td>
                  <Td className="ltr-nums text-xs text-gray-500">{e.reference ?? ""}</Td>
                  <Td className="ltr-nums text-xs">{lines}</Td>
                  <Td className="ltr-nums font-semibold whitespace-nowrap">{fmt(total)}</Td>
                  <Td>
                    <Badge tone={ENTRY_STATUS[e.status].tone}>{ENTRY_STATUS[e.status].label}</Badge>
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
