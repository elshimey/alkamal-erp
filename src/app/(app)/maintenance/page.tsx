import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { vehicleOptions } from "@/lib/lookups";
import { cashAccounts } from "@/lib/invoices";
import { getCompany, getInvoiceTemplate } from "@/lib/company";
import { ORDER_SORTS, listOrders, orderDoc, type OrderFilter } from "@/lib/maintenance";
import { listHref, parseDocFilter, type DocListParams } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { MAINTENANCE_PROVIDERS, MAINTENANCE_STATUS, MAINTENANCE_TYPES, type MaintenanceType } from "@/data/maintenance";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { BulkPdfButton } from "@/components/bulk-pdf";
import { DocSheet, type DocSheetRow } from "@/components/doc-sheet";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { ListActions } from "@/components/list-actions";
import { MaintenanceOrderDocument } from "@/components/maintenance-document";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { Badge, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { MaintenanceTabs } from "./tabs";
import { OrderPanel } from "./order-panel";
import { approveOrder, bulkOrders, completeOrder, revertOrder, saveOrderSheet } from "./actions";
import { fmt } from "@/lib/format";

type Status = keyof typeof MAINTENANCE_STATUS;
const BASE = "/maintenance";
const BULK_FORM = "bulk-orders";
const STATUSES = Object.fromEntries(Object.entries(MAINTENANCE_STATUS).map(([k, v]) => [k, v.label]));
type Params = DocListParams & { vehicle?: string; type?: string; provider?: string; request?: string; plan?: string; new?: string };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission("maintenance", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const df = parseDocFilter(sp, Object.keys(STATUSES), today);
  const filter: OrderFilter = {
    q: df.q,
    from: df.from,
    to: df.to,
    status: df.status as Status | undefined,
    vehicleId: Number(sp.vehicle) || undefined,
    type: sp.type && sp.type in MAINTENANCE_TYPES ? (sp.type as MaintenanceType) : undefined,
    provider: sp.provider === "internal" || sp.provider === "external" ? sp.provider : undefined,
    sort: sp.sort && sp.sort in ORDER_SORTS ? (sp.sort as keyof typeof ORDER_SORTS) : undefined,
  };
  const view = sp.view === "sheet" ? "sheet" : "table";
  const fromSource = !!(sp.request || sp.plan);
  const openId = view === "table" ? Number(sp.open) || null : null;
  const [vehicles, cashes, list, unfiltered, openDoc, company, template] = await Promise.all([
    vehicleOptions(),
    cashAccounts(db),
    // القادم من طلب عطل أو خطة بمركبة محددة يرى نافذة الإنشاء، لا تصفية القائمة بالمركبة
    listOrders(db, fromSource ? { ...filter, vehicleId: undefined, type: undefined } : filter),
    // عدادات الحالات لا تتأثر بفلتر الحالة نفسه
    filter.status ? listOrders(db, { ...filter, status: undefined }) : Promise.resolve(null),
    openId ? orderDoc(db, openId) : Promise.resolve(null),
    getCompany(db),
    getInvoiceTemplate(db),
  ]);
  const canCreate = can(user.perms, "maintenance", "create");
  const creating = canCreate && (sp.new === "1" || fromSource);
  const listParams = { ...sp, new: undefined, request: undefined, plan: undefined, ...(fromSource ? { vehicle: undefined, type: undefined } : {}) };
  const canApprove = can(user.perms, "maintenance", "approve");
  const canUpdate = can(user.perms, "maintenance", "update");
  const selectable = list.filter(({ o }) => (o.status === "draft" && canApprove) || (o.status === "approved" && canUpdate));
  const count = (st: Status) => (unfiltered ?? list).filter(({ o }) => o.status === st).length;
  const totalOf = () => list.reduce((t, { o }) => t + Number(o.total) * Number(o.exchangeRate), 0);

  return (
    <>
      <PageHeader title="الصيانة" description="أمر الصيانة ببنوده (قطع غيار وشغل يد) يُقيد على مركز تكلفة مركبته عند الاعتماد، والمركبة تبقى «في الصيانة» حتى الإكمال.">
        <ListActions newHref={canCreate && listHref(BASE, { ...listParams, open: undefined, new: "1" } as Params, {})} newLabel="أمر صيانة جديد" importHref={canCreate && "/import/maintenance-orders"} />
      </PageHeader>
      <MaintenanceTabs active="orders" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "مسودات بانتظار الاعتماد", value: count("draft"), href: listHref(BASE, sp, { status: "draft", open: undefined }) },
          { label: "تحت التنفيذ (المركبة في الورشة)", value: count("approved"), href: listHref(BASE, sp, { status: "approved", open: undefined }) },
          { label: "مكتملة", value: count("completed"), href: listHref(BASE, sp, { status: "completed", open: undefined }) },
          { label: "إجمالي المعروض (ر.س)", value: totalOf(), money: true },
        ].map((k) => {
          const body = (
            <>
              <div className="text-xs text-gray-500">{k.label}</div>
              <div className="ltr-nums mt-1 font-display text-xl font-semibold text-brand-900">{k.money ? fmt(k.value) : k.value}</div>
            </>
          );
          return k.href ? (
            <Link key={k.label} href={k.href} scroll={false} className="rounded-2xl bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow">
              {body}
            </Link>
          ) : (
            <div key={k.label} className="rounded-2xl bg-asphalt-900 p-4 shadow-sm [&_div]:text-white [&_div:first-child]:text-white/60">
              {body}
            </div>
          );
        })}
      </div>

      <DocToolbar base={BASE} params={sp} statuses={STATUSES} pay={false} sorts={ORDER_SORTS} noun="أمر" exportName="أوامر-الصيانة" count={list.length} placeholder="ابحث بالرقم أو اللوحة أو الورشة أو فاتورتها" />
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm print:hidden">
        {(["q", "period", "status", "sort", "view"] as const).map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
        <Select name="vehicle" defaultValue={filter.vehicleId ?? ""} className="w-36">
          <option value="">كل المركبات</option>
          {vehicles.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select name="type" defaultValue={filter.type ?? ""} className="w-44">
          <option value="">كل الأنواع</option>
          {Object.entries(MAINTENANCE_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select name="provider" defaultValue={filter.provider ?? ""} className="w-40">
          <option value="">كل الجهات</option>
          {Object.entries(MAINTENANCE_PROVIDERS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">تصفية</button>
        <span className="ms-auto">
          <BulkPdfButton kind="maintenance" ids={list.map((x) => x.o.id)} />
        </span>
      </form>

      {view === "sheet" ? (
        <DocSheet
          action={saveOrderSheet}
          emptyText="لا توجد أوامر بهذه الشروط"
          columns={[
            { key: "status", label: "الحالة", type: "badge", width: "6.5rem" },
            { key: "number", label: "الرقم", ltr: true, width: "8rem" },
            { key: "orderDate", label: "التاريخ", type: "date", editable: true, width: "8.5rem" },
            { key: "plate", label: "المركبة", width: "8rem" },
            { key: "type", label: "النوع", width: "10rem" },
            { key: "provider", label: "الجهة", width: "11rem" },
            { key: "supplierInvoiceNo", label: "فاتورة الورشة", editable: true, ltr: true, width: "8rem" },
            { key: "odometer", label: "العداد", editable: true, ltr: true, width: "6rem" },
            { key: "lines", label: "البنود", ltr: true, width: "4rem" },
            { key: "subtotal", label: "قبل الضريبة", type: "number", width: "7rem" },
            { key: "vat", label: "الضريبة", type: "number", width: "6rem" },
            { key: "total", label: "الإجمالي", type: "number", width: "7rem" },
            { key: "notes", label: "ملاحظات", editable: true, width: "14rem" },
          ]}
          rows={list.map(({ o, plate, supplier, lines, typeLabel }): DocSheetRow => ({
            id: o.id,
            href: `/maintenance/${o.id}`,
            editable: o.status === "draft" && canUpdate,
            cells: {
              number: o.number,
              orderDate: o.orderDate,
              plate,
              type: (typeLabel ?? MAINTENANCE_TYPES[o.type]),
              provider: supplier ?? MAINTENANCE_PROVIDERS.internal,
              supplierInvoiceNo: o.supplierInvoiceNo,
              odometer: o.odometer != null ? String(o.odometer) : null,
              lines: String(lines),
              subtotal: o.subtotal,
              vat: o.vatTotal,
              total: o.total,
              notes: o.notes,
            },
            badges: { status: { label: MAINTENANCE_STATUS[o.status].label, tone: MAINTENANCE_STATUS[o.status].tone } },
          }))}
        />
      ) : openDoc ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,22rem)_1fr]">
          <ul className="hidden max-h-[calc(100vh-9rem)] lg:block divide-y divide-gray-100 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm print:hidden lg:sticky lg:top-4">
            {list.map(({ o, plate, supplier, typeLabel }) => (
              <li key={o.id}>
                <Link
                  href={listHref(BASE, sp, { open: String(o.id) })}
                  scroll={false}
                  className={`block border-s-4 px-4 py-3 transition ${o.id === openId ? "border-brand-500 bg-brand-50/70" : "border-transparent hover:bg-gray-50"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-semibold text-gray-800">
                      {plate} · {(typeLabel ?? MAINTENANCE_TYPES[o.type])}
                    </span>
                    <span className="ltr-nums shrink-0 text-sm font-semibold text-brand-900">{fmt(o.total)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                    <span className="ltr-nums whitespace-nowrap">{o.number}</span>
                    <span className="text-gray-300">|</span>
                    <span className="ltr-nums whitespace-nowrap">{o.orderDate}</span>
                    <span className="line-clamp-1">{supplier ?? MAINTENANCE_PROVIDERS.internal}</span>
                    <span className="ms-auto">
                      <Badge tone={MAINTENANCE_STATUS[o.status].tone}>{MAINTENANCE_STATUS[o.status].label}</Badge>
                    </span>
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
                    أمر <span className="ltr-nums">{openDoc.o.number}</span>
                  </span>
                  <Badge tone={MAINTENANCE_STATUS[openDoc.o.status].tone}>{MAINTENANCE_STATUS[openDoc.o.status].label}</Badge>
                </div>
                <div className="text-xs text-gray-500">
                  {openDoc.plate} · {openDoc.supplier ?? MAINTENANCE_PROVIDERS.internal}
                </div>
              </div>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <Link href={`/print/maintenance?ids=${openDoc.o.id}`} target="_blank" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                  طباعة
                </Link>
                <Link href={`/maintenance/${openDoc.o.id}`} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                  {openDoc.o.status === "draft" ? "تعديل البنود" : "فتح الأمر"}
                </Link>
                {openDoc.o.status === "draft" && canApprove && openDoc.lines.length > 0 && (
                  <ActionForm action={approveOrder.bind(null, openDoc.o.id)} resetOnSuccess={false} className="flex items-center gap-2">
                    {openDoc.o.provider === "internal" && !openDoc.o.supplierId && openDoc.lines.some(({ l }) => !l.warehouseId) && (
                      <Select name="cashAccountId" defaultValue={openDoc.o.cashAccountId ?? ""} className="w-40">
                        <option value="">القطع من صندوق…</option>
                        {cashes.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nameAr}
                          </option>
                        ))}
                      </Select>
                    )}
                    <SubmitButton>اعتماد وترحيل القيد</SubmitButton>
                  </ActionForm>
                )}
                {openDoc.o.status === "approved" && canUpdate && (
                  <ActionForm action={completeOrder.bind(null, openDoc.o.id)} resetOnSuccess={false} className="flex items-center gap-2">
                    <Input type="date" name="completedDate" defaultValue={today} className="w-40" />
                    <SubmitButton>إكمال وإعادة المركبة</SubmitButton>
                  </ActionForm>
                )}
                {openDoc.o.status === "approved" && can(user.perms, "maintenance", "revert") && (
                  <ActionForm action={revertOrder.bind(null, openDoc.o.id)} resetOnSuccess={false}>
                    <SubmitButton variant="secondary">إرجاع لمسودة</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
            {openDoc.o.status === "draft" && openDoc.lines.length === 0 && (
              <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-900">
                لا بنود في الأمر بعد.{" "}
                <Link href={`/maintenance/${openDoc.o.id}`} className="font-semibold underline">
                  أضف القطع وشغل اليد
                </Link>{" "}
                ثم اعتمده.
              </div>
            )}
            <div className="p-4 sm:p-6">
              <div className="mx-auto max-w-3xl">
                <MaintenanceOrderDocument company={company} doc={openDoc} template={template} compact />
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
          {selectable.length > 0 && (
            <ActionForm id={BULK_FORM} action={bulkOrders} className="mb-3 flex flex-wrap items-end gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
              <SelectionTotal form={BULK_FORM} noun="أمر" />
              <Field label="الإجراء">
                <Select name="op" defaultValue={canApprove ? "approve" : "complete"} className="w-52">
                  {canApprove && <option value="approve">اعتماد المسودات وترحيل قيودها</option>}
                  {canUpdate && <option value="complete">إكمال وإعادة المركبات للعمل</option>}
                </Select>
              </Field>
              <Field label="تاريخ الإكمال">
                <Input type="date" name="date" defaultValue={today} className="w-40" />
              </Field>
              <SubmitButton variant="secondary">تنفيذ على المحدد</SubmitButton>
            </ActionForm>
          )}
          <Table head={[selectable.length ? <SelectAll key="all" form={BULK_FORM} /> : "", "الرقم", "التاريخ", "المركبة", "النوع", "الجهة", "المصدر", "الإجمالي", "الحالة", ""]}>
            {list.length === 0 && <EmptyRow cols={10}>{filter.q || filter.status || filter.from || filter.vehicleId ? "لا توجد أوامر بهذه الشروط" : "لا توجد أوامر صيانة بعد"}</EmptyRow>}
            {list.map(({ o, plate, supplier, request, plan, lines, typeLabel }) => {
              const open = listHref(BASE, sp, { open: String(o.id) });
              return (
                <tr key={o.id} className="transition hover:bg-brand-50/40">
                  <Td>{selectable.some((x) => x.o.id === o.id) && <RowCheck form={BULK_FORM} id={o.id} amount={o.total} />}</Td>
                  <Td className="font-medium whitespace-nowrap">
                    <Link href={open} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                      {o.number}
                    </Link>
                    {o.supplierInvoiceNo && <div className="ltr-nums text-xs font-normal text-gray-400">{o.supplierInvoiceNo}</div>}
                  </Td>
                  <Td className="ltr-nums whitespace-nowrap">{o.orderDate}</Td>
                  <Td className="font-medium whitespace-nowrap">
                    <Link href={open} scroll={false} className="hover:text-brand-700">
                      {plate}
                    </Link>
                  </Td>
                  <Td>{(typeLabel ?? MAINTENANCE_TYPES[o.type])}</Td>
                  <Td>{supplier ?? MAINTENANCE_PROVIDERS.internal}</Td>
                  <Td className="text-xs">{request ? `عطل ${request}` : plan ? `دورية: ${plan}` : "—"}</Td>
                  <Td className="ltr-nums font-semibold whitespace-nowrap">
                    {fmt(o.total)}
                    {o.status === "draft" && lines === 0 && <div className="text-[11px] font-normal text-amber-700">بلا بنود</div>}
                  </Td>
                  <Td>
                    <Badge tone={MAINTENANCE_STATUS[o.status].tone}>{MAINTENANCE_STATUS[o.status].label}</Badge>
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
        </>
      )}
      {creating && (
        <OrderPanel
          closeHref={listHref(BASE, listParams as Params, {})}
          savedHref={listHref(BASE, { ...listParams, view: undefined } as Params, { open: "ID" }).replace("open=ID", "open={id}")}
          vehicle={sp.vehicle}
          request={sp.request}
          plan={sp.plan}
          type={sp.type}
        />
      )}
    </>
  );
}
