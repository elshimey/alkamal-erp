import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listNotes, noteDoc } from "@/lib/notes";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { NOTE_KINDS, NOTE_SIDES, NOTE_STATUS, type NoteKind, type NoteSide } from "@/data/sales";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { NoteDocument } from "@/components/note-document";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { post, remove, revert } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SORTS = { date_desc: "الأحدث أولاً", date_asc: "الأقدم أولاً", amount_desc: "الأعلى مبلغاً", amount_asc: "الأقل مبلغاً" } as const;
const btn = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50";

export default async function NotesPage({ params, searchParams }: { params: Promise<{ side: string }>; searchParams: Promise<DocListParams> }) {
  const sideKey = (await params).side;
  if (!(sideKey in NOTE_SIDES)) notFound();
  const side = sideKey as NoteSide;
  const cfg = NOTE_SIDES[side];
  const user = await requirePermission(cfg.entity, "view");
  const sp = await searchParams;
  const base = `/notes/${side}`;
  const kinds = Object.fromEntries(cfg.kinds.map((k) => [k, NOTE_KINDS[k].label]));
  const f = parseDocFilter(sp, cfg.kinds, todayRiyadh());
  const openId = Number(sp.open) || null;
  const [list, doc, company, template] = await Promise.all([
    listNotes(db, { side, q: f.q, from: f.from, to: f.to, kind: f.status as NoteKind | undefined, sort: f.sort in SORTS ? (f.sort as keyof typeof SORTS) : undefined }),
    openId ? noteDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  const openDoc = doc && NOTE_KINDS[doc.n.kind].side === side ? doc : null;
  const canCreate = can(user.perms, cfg.entity, "create");

  const kindBadge = (k: NoteKind) => <Badge tone={NOTE_KINDS[k].tone}>{NOTE_KINDS[k].label}</Badge>;

  return (
    <>
      <PageHeader title={cfg.title} description={side === "sales" ? "الإشعارات الدائنة (تخفيض أو مرتجع) والمدينة (زيادة) على فواتير العملاء، ضريبية وقابلة للطباعة." : "إشعارات المرتجعات والخصومات من الموردين وفروق الأسعار عليهم."}>
        {canCreate && (
          <div className="flex flex-wrap gap-2">
            {cfg.kinds.map((k, i) => (
              <Link key={k} href={`${base}/new?kind=${k}`} className={i === 0 ? "rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500" : btn}>
                + {NOTE_KINDS[k].label}
              </Link>
            ))}
          </div>
        )}
      </PageHeader>

      <DocToolbar base={base} params={sp} statuses={kinds} allStatuses="كل الأنواع" pay={false} views={false} sorts={SORTS} noun="إشعار" exportName={cfg.title} count={list.length} />
      <div className="mb-2 flex justify-end">
        <BulkPdfButton kind="notes" ids={list.map((x) => x.n.id)} />
      </div>

      {openDoc ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,22rem)_1fr]">
          <ul className="hidden max-h-[calc(100vh-9rem)] lg:block divide-y divide-gray-100 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm print:hidden lg:sticky lg:top-4">
            {list.map(({ n, party }) => (
              <li key={n.id}>
                <Link href={listHref(base, sp, { open: String(n.id) })} scroll={false} className={`block border-s-4 px-4 py-3 transition ${n.id === openId ? "border-brand-500 bg-brand-50/70" : "border-transparent hover:bg-gray-50"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-semibold text-gray-800">{party}</span>
                    <span className="ltr-nums text-sm font-semibold whitespace-nowrap">{fmt(n.total)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    <span className="ltr-nums">{n.number}</span>
                    <span className="ltr-nums">{n.noteDate}</span>
                    <span className="ms-auto">{kindBadge(n.kind)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <section className="animate-flyout min-w-0 rounded-2xl bg-gray-100/70 shadow-inner">
            <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
              <Link href={listHref(base, sp, { open: undefined })} scroll={false} aria-label="إغلاق المعاينة" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
                <Icon name="close" className="size-4" />
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-semibold text-brand-900">
                    {NOTE_KINDS[openDoc.n.kind].label} <span className="ltr-nums">{openDoc.n.number}</span>
                  </span>
                  <Badge tone={NOTE_STATUS[openDoc.n.status].tone}>{NOTE_STATUS[openDoc.n.status].label}</Badge>
                </div>
                <div className="text-xs text-gray-500">{openDoc.party.nameAr}</div>
              </div>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <Link href={`${base}/${openDoc.n.id}?print=1`} target="_blank" className={btn}>
                  طباعة
                </Link>
                {openDoc.n.status === "draft" && can(user.perms, cfg.entity, "approve") && (
                  <ActionForm action={post.bind(null, side, openDoc.n.id)} resetOnSuccess={false}>
                    <SubmitButton>ترحيل</SubmitButton>
                  </ActionForm>
                )}
                {openDoc.n.status === "posted" && can(user.perms, cfg.entity, "revert") && (
                  <ActionForm action={revert.bind(null, side, openDoc.n.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">إرجاع لمسودة</SubmitButton>
                  </ActionForm>
                )}
                {openDoc.n.status === "draft" && can(user.perms, cfg.entity, "delete") && (
                  <ActionForm action={remove.bind(null, side, openDoc.n.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">حذف</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
            <div className="p-4 sm:p-6">
              <div className="mx-auto max-w-3xl">
                <NoteDocument company={company} doc={openDoc} template={template} compact />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <Table head={["التاريخ", "الرقم", cfg.party, "النوع", "الفاتورة الأصلية", "السبب", "الإجمالي", "الحالة"]}>
          {list.length === 0 && <EmptyRow cols={8}>{f.q || f.status || f.from ? "لا توجد إشعارات بهذه الشروط" : "لا توجد إشعارات بعد"}</EmptyRow>}
          {list.map(({ n, party, invoice }) => {
            const open = listHref(base, sp, { open: String(n.id) });
            return (
              <tr key={n.id} className="transition hover:bg-brand-50/40">
                <Td className="ltr-nums whitespace-nowrap">{n.noteDate}</Td>
                <Td className="font-medium whitespace-nowrap">
                  <Link href={open} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                    {n.number}
                  </Link>
                </Td>
                <Td>
                  <Link href={open} scroll={false} className="hover:text-brand-700">
                    {party}
                  </Link>
                </Td>
                <Td>{kindBadge(n.kind)}</Td>
                <Td className="ltr-nums text-xs">{invoice ?? <span className="text-gray-300">—</span>}</Td>
                <Td className="max-w-56 truncate text-xs text-gray-600">{n.reason}</Td>
                <Td className="ltr-nums font-semibold whitespace-nowrap">
                  {fmt(n.total)} <span className="text-[10px] font-normal text-gray-400">{n.currencyCode}</span>
                </Td>
                <Td>
                  <Badge tone={NOTE_STATUS[n.status].tone}>{NOTE_STATUS[n.status].label}</Badge>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
