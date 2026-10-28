import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { driverOptions, vehicleOptions } from "@/lib/lookups";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { listRequests, requestDoc, type RequestFilter } from "@/lib/maintenance";
import { listAttachments } from "@/lib/attachments";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { BREAKDOWN_APPROVAL_LIMIT, BREAKDOWN_STATUS, MAINTENANCE_STATUS, PRIORITIES, type BreakdownStatus } from "@/data/maintenance";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { BreakdownRequestDocument } from "@/components/maintenance-document";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { RequestPanel } from "../request-panel";
import { MaintenanceTabs } from "../tabs";
import { approveRequest, bulkRequests, rejectRequest, reviewRequest, saveRequests } from "../actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { maximumFractionDigits: 2 });
const BASE = "/maintenance/requests";
const BULK_FORM = "bulk-requests";
const STATUSES = Object.fromEntries(Object.entries(BREAKDOWN_STATUS).map(([k, v]) => [k, v.label]));
const SORTS = {};
type Params = DocListParams & { vehicle?: string; priority?: string; new?: string; add?: string };

export default async function BreakdownRequestsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission("maintenance", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const df = parseDocFilter(sp, Object.keys(STATUSES), today);
  const filter: RequestFilter = {
    q: df.q,
    from: df.from,
    to: df.to,
    status: df.status as BreakdownStatus | undefined,
    vehicleId: Number(sp.vehicle) || undefined,
    priority: sp.priority && sp.priority in PRIORITIES ? (sp.priority as keyof typeof PRIORITIES) : undefined,
  };
  const openId = Number(sp.open) || null;
  const [vehicles, drivers, list, openDoc, company, template] = await Promise.all([
    vehicleOptions(),
    driverOptions(),
    listRequests(db, filter),
    openId ? requestDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  // صورة المشكلة التي رفعها السائق مع طلب الصيانة
  const photoOf = new Map<number, number>();
  for (const a of await listAttachments(db, "breakdown_requests", list.map((x) => x.r.id))) if (!photoOf.has(a.entityId)) photoOf.set(a.entityId, a.id);
  const canCreate = can(user.perms, "maintenance", "create");
  const canReview = can(user.perms, "maintenance", "update");
  const canApprove = can(user.perms, "maintenance", "approve");
  const actionable = (st: BreakdownStatus, hasOrder: boolean) => (st === "pending_supervisor" && canReview) || (st === "pending_approval" && canApprove) || (st === "approved" && !hasOrder && canCreate);
  const selectable = list.filter(({ r, order }) => actionable(r.status, !!order?.id));
  const waiting = list.filter(({ r }) => r.status === "pending_supervisor" || r.status === "pending_approval").length;
  const urgent = list.filter(({ r }) => r.priority === "urgent" && !["completed", "rejected"].includes(r.status)).length;

  const listParams = { ...sp, new: undefined, add: undefined };
  const description = `بلاغ العطل من السائق أو المكتب. يراجعه المشرف ويعتمده إن كانت تكلفته حتى ${BREAKDOWN_APPROVAL_LIMIT.toLocaleString("en")} ر.س، وما فوقها يعتمده المدير، ثم يتحول إلى أمر صيانة.`;

  if (sp.add === "1" && canCreate)
    return (
      <>
        <PageHeader title="الصيانة" description={description} />
        <AddModeBar backHref={BASE} backLabel="بلاغات الأعطال" title="تسجيل بلاغات جماعي" />
        <Card className="mb-6">
          <SheetEditor
            templateName="طلبات العطل"
            action={saveRequests}
            initialRows={4}
            columns={[
              { key: "date", label: "التاريخ", type: "date", placeholder: today },
              { key: "vehicleId", label: "المركبة", type: "select", required: true, options: vehicles, width: "9rem", create: "vehicle" },
              { key: "driverId", label: "السائق", type: "select", options: drivers, width: "10rem" },
              { key: "description", label: "وصف العطل", required: true, width: "20rem" },
              { key: "priority", label: "الأولوية", type: "select", options: Object.entries(PRIORITIES).map(([value, p]) => ({ value, label: p.label })), width: "7rem", placeholder: "عادية" },
              { key: "estimatedCost", label: "التكلفة التقديرية", type: "number", width: "8rem" },
            ]}
          />
          <p className="mt-2 text-xs text-gray-500">اكتب أو الصق من Excel عدة بلاغات معاً؛ الصف المخالف يبقى في الشيت مع سبب رفضه.</p>
        </Card>
      </>
    );

  return (
    <>
      <PageHeader title="الصيانة" description={description}>
        <ListActions
          newHref={canCreate && listHref(BASE, { ...listParams, open: undefined, new: "1" } as Params, {})}
          newLabel="بلاغ عطل جديد"
          addHref={canCreate && `${BASE}?add=1`}
          addLabel="تسجيل بلاغات جماعي"
          importHref={canCreate && "/import/breakdown-requests"}
        />
      </PageHeader>
      <MaintenanceTabs active="requests" />

      {(waiting > 0 || urgent > 0) && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {waiting > 0 && (
            <Link href={listHref(BASE, sp, { status: "pending_supervisor", open: undefined })} className="rounded-xl bg-brand-50 px-3 py-2 text-amber-900 hover:bg-brand-100">
              {waiting} بلاغ بانتظار المراجعة أو الاعتماد
            </Link>
          )}
          {urgent > 0 && <span className="rounded-xl bg-red-50 px-3 py-2 text-red-800">{urgent} بلاغ عاجل لم يكتمل</span>}
        </div>
      )}

      <DocToolbar base={BASE} params={sp} statuses={STATUSES} pay={false} views={false} sorts={SORTS} noun="بلاغ" exportName="بلاغات-الأعطال" count={list.length} placeholder="ابحث بالرقم أو اللوحة أو السائق أو العطل" />
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm print:hidden">
        {(["q", "period", "status"] as const).map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
        <Select name="vehicle" defaultValue={filter.vehicleId ?? ""} className="w-36">
          <option value="">كل المركبات</option>
          {vehicles.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select name="priority" defaultValue={filter.priority ?? ""} className="w-32">
          <option value="">كل الأولويات</option>
          {Object.entries(PRIORITIES).map(([k, p]) => (
            <option key={k} value={k}>
              {p.label}
            </option>
          ))}
        </Select>
        <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">تصفية</button>
        <span className="ms-auto">
          <BulkPdfButton kind="breakdowns" ids={list.map((x) => x.r.id)} />
        </span>
      </form>

      {openDoc && (
        <section className="animate-flyout mb-6 rounded-2xl bg-gray-100/70 shadow-inner">
          <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
            <Link href={listHref(BASE, sp, { open: undefined })} scroll={false} aria-label="إغلاق المعاينة" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
              <Icon name="close" className="size-4" />
            </Link>
            <span className="ltr-nums font-display text-lg font-semibold text-brand-900">{openDoc.r.number}</span>
            <Badge tone={BREAKDOWN_STATUS[openDoc.r.status].tone}>{BREAKDOWN_STATUS[openDoc.r.status].label}</Badge>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Link href={`/print/breakdowns?ids=${openDoc.r.id}`} target="_blank" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                طباعة
              </Link>
              {openDoc.r.status === "pending_supervisor" && canReview && (
                <ActionForm action={reviewRequest.bind(null, openDoc.r.id)} resetOnSuccess={false} className="flex items-center gap-2">
                  <Input name="estimatedCost" type="number" min={0} placeholder="التكلفة التقديرية" defaultValue={openDoc.r.estimatedCost ?? ""} className="w-36" />
                  <SubmitButton>مراجعة المشرف</SubmitButton>
                </ActionForm>
              )}
              {openDoc.r.status === "pending_approval" && canApprove && (
                <ActionForm action={approveRequest.bind(null, openDoc.r.id)} resetOnSuccess={false}>
                  <SubmitButton>اعتماد المدير</SubmitButton>
                </ActionForm>
              )}
              {openDoc.r.status === "approved" && !openDoc.order?.id && canCreate && (
                <Link href={`/maintenance?new=1&vehicle=${openDoc.r.vehicleId}&request=${openDoc.r.id}`} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
                  إنشاء أمر صيانة
                </Link>
              )}
              {openDoc.order?.id && (
                <Link href={`/maintenance?open=${openDoc.order.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                  أمر الصيانة <span className="ltr-nums">{openDoc.order.number}</span>
                </Link>
              )}
              {["pending_supervisor", "pending_approval", "approved"].includes(openDoc.r.status) && !openDoc.order?.id && canReview && (
                <ActionForm action={rejectRequest.bind(null, openDoc.r.id)} className="flex items-center gap-2">
                  <Input name="reason" placeholder="سبب الرفض" className="w-36" />
                  <SubmitButton variant="secondary">رفض</SubmitButton>
                </ActionForm>
              )}
            </div>
          </div>
          <div className="p-4 sm:p-6">
            <div className="mx-auto max-w-3xl">
              <BreakdownRequestDocument company={company} doc={openDoc} template={template} compact />
            </div>
          </div>
        </section>
      )}

      {selectable.length > 0 && (
        <ActionForm id={BULK_FORM} action={bulkRequests} className="mb-3 flex flex-wrap items-end gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
          <SelectionTotal form={BULK_FORM} noun="بلاغ" />
          <Field label="الإجراء">
            <Select name="op" defaultValue={canReview ? "review" : canApprove ? "approve" : "order"} className="w-56">
              {canReview && <option value="review">مراجعة المشرف (بالتكلفة المسجلة)</option>}
              {canApprove && <option value="approve">اعتماد المدير</option>}
              {canCreate && <option value="order">إنشاء أوامر صيانة للمعتمد</option>}
            </Select>
          </Field>
          <Field label="تاريخ الأمر">
            <Input type="date" name="date" defaultValue={today} className="w-40" />
          </Field>
          <SubmitButton variant="secondary">تنفيذ على المحدد</SubmitButton>
        </ActionForm>
      )}
      <Table head={[selectable.length ? <SelectAll key="all" form={BULK_FORM} /> : "", "الرقم", "التاريخ", "المركبة", "العطل", "الأولوية", "التكلفة التقديرية", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={9}>{filter.q || filter.status || filter.from || filter.vehicleId ? "لا توجد بلاغات بهذه الشروط" : "لا توجد بلاغات أعطال بعد"}</EmptyRow>}
        {list.map(({ r, plate, driver, order }) => {
          const open = listHref(BASE, sp, { open: String(r.id) });
          return (
            <tr key={r.id} className={r.id === openId ? "bg-brand-50/70" : "transition hover:bg-brand-50/40"}>
              <Td>{actionable(r.status, !!order?.id) && <RowCheck form={BULK_FORM} id={r.id} amount={r.estimatedCost ?? "0"} />}</Td>
              <Td className="font-medium whitespace-nowrap">
                <Link href={open} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                  {r.number}
                </Link>
              </Td>
              <Td className="ltr-nums whitespace-nowrap">{r.reportDate}</Td>
              <Td className="font-medium">
                {plate}
                {driver && <div className="text-xs font-normal text-gray-500">{driver}</div>}
              </Td>
              <Td>
                <span className="line-clamp-2">{r.description}</span>
                {photoOf.has(r.id) && (
                  <a href={`/files/${photoOf.get(r.id)}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-700 hover:underline">
                    📷 صورة السائق
                  </a>
                )}
                {r.rejectReason && <div className="text-xs text-red-600">سبب الرفض: {r.rejectReason}</div>}
              </Td>
              <Td>
                <Badge tone={PRIORITIES[r.priority].tone}>{PRIORITIES[r.priority].label}</Badge>
              </Td>
              <Td className="ltr-nums">{r.estimatedCost != null ? fmt(r.estimatedCost) : "—"}</Td>
              <Td>
                <Badge tone={BREAKDOWN_STATUS[r.status].tone}>{BREAKDOWN_STATUS[r.status].label}</Badge>
                {order?.id && (
                  <Link href={`/maintenance?open=${order.id}`} className="ltr-nums mt-1 block text-xs text-brand-700 hover:underline">
                    {order.number} · {MAINTENANCE_STATUS[order.status!].label}
                  </Link>
                )}
              </Td>
              <Td>
                <Link href={open} scroll={false} aria-label="معاينة" className="inline-flex rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-700">
                  <Icon name="expand" className="size-4" />
                </Link>
              </Td>
            </tr>
          );
        })}
      </Table>
      {sp.new === "1" && canCreate && (
        <RequestPanel closeHref={listHref(BASE, listParams as Params, {})} savedHref={listHref(BASE, listParams as Params, { open: "ID" }).replace("open=ID", "open={id}")} />
      )}
    </>
  );
}
