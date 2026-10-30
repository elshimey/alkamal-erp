import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { vehicleOptions } from "@/lib/lookups";
import { planSchedule } from "@/lib/maintenance";
import { customListOptions } from "@/lib/custom-lists";
import { joinCustom } from "@/data/custom-lists";
import { listHref, type DocListParams } from "@/lib/doc-filters";
import { todayRiyadh } from "@/lib/dates";
import { MAINTENANCE_STATUS, MAINTENANCE_TYPES, PLAN_ALERT_DAYS } from "@/data/maintenance";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DocToolbar } from "@/components/doc-toolbar";
import { Icon } from "@/components/icons";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { RowCheck, SelectAll, SelectionTotal } from "@/components/row-selection";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { PlanPanel } from "../plan-panel";
import { MaintenanceTabs } from "../tabs";
import { bulkPlanOrders, savePlans } from "../actions";
import { fmt } from "@/lib/format";

const BASE = "/maintenance/plans";
const BULK_FORM = "plan-orders";
const STATUSES = { overdue: "متأخرة", soon: `مستحقة خلال ${PLAN_ALERT_DAYS} أيام`, ok: "في موعدها" };
type Params = DocListParams & { vehicle?: string; type?: string; new?: string; add?: string; edit?: string };

export default async function PlansPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission("maintenance", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const [vehicles, kinds, all, openOrders] = await Promise.all([
    vehicleOptions(),
    customListOptions(db, "maintenance_kind"),
    planSchedule(db, today),
    // الأوامر غير المكتملة المرتبطة بالخطط: لا يُنشأ للخطة أمر ثانٍ
    db
      .select({ planId: s.maintenanceOrders.planId, id: s.maintenanceOrders.id, number: s.maintenanceOrders.number, status: s.maintenanceOrders.status })
      .from(s.maintenanceOrders)
      .where(inArray(s.maintenanceOrders.status, ["draft", "approved"])),
  ]);
  const openByPlan = new Map(openOrders.filter((o) => o.planId).map((o) => [o.planId!, o]));
  const state = (days: number) => (days < 0 ? "overdue" : days <= PLAN_ALERT_DAYS ? "soon" : "ok");
  const q = sp.q?.trim().toLowerCase();
  const plans = all.filter(
    (p) =>
      (!sp.status || state(p.days) === sp.status) &&
      (!Number(sp.vehicle) || p.vehicleId === Number(sp.vehicle)) &&
      (!sp.type || p.type === sp.type) &&
      (!q || `${p.plate} ${p.title} ${(p.typeLabel ?? MAINTENANCE_TYPES[p.type])}`.toLowerCase().includes(q)),
  );
  const openId = Number(sp.open) || null;
  const openPlan = openId ? all.find((p) => p.id === openId) : null;
  const history = openPlan
    ? await db
        .select({ id: s.maintenanceOrders.id, number: s.maintenanceOrders.number, orderDate: s.maintenanceOrders.orderDate, completedDate: s.maintenanceOrders.completedDate, total: s.maintenanceOrders.total, status: s.maintenanceOrders.status })
        .from(s.maintenanceOrders)
        .where(eq(s.maintenanceOrders.planId, openPlan.id))
        .orderBy(desc(s.maintenanceOrders.orderDate))
        .limit(20)
    : [];
  const canCreate = can(user.perms, "maintenance", "create");
  const selectable = canCreate ? plans.filter((p) => !openByPlan.has(p.id)) : [];
  const counts = { overdue: all.filter((p) => p.days < 0).length, soon: all.filter((p) => state(p.days) === "soon").length };

  const canUpdate = can(user.perms, "maintenance", "update");
  const listParams = { ...sp, new: undefined, add: undefined, edit: undefined };
  const description = `خطة دورية لكل مركبة بالمدة (بالأيام). تظهر في التنبيهات قبل موعدها بـ ${PLAN_ALERT_DAYS} أيام، وإكمال أمر صيانة مرتبط بها يحدّث آخر تنفيذ.`;
  const editId = canUpdate ? Number(sp.edit) || null : null;

  if (sp.add === "1" && canUpdate)
    return (
      <>
        <PageHeader title="الصيانة" description={description} />
        <AddModeBar backHref={BASE} backLabel="الصيانة الدورية" title="إضافة خطط جماعية" />
        <Card className="mb-6">
          <SheetEditor
            templateName="الصيانة الدورية"
            action={savePlans}
            initialRows={4}
            columns={[
              { key: "vehicleId", label: "المركبة", type: "select", required: true, options: vehicles, width: "9rem", create: "vehicle" },
              { key: "type", label: "النوع", type: "select", required: true, options: kinds, create: "maintenance_kind", width: "11rem" },
              { key: "title", label: "اسم الصيانة", required: true, width: "14rem", placeholder: "تغيير زيت" },
              { key: "intervalDays", label: "كل (يوم)", type: "number", required: true, width: "6rem", placeholder: "30" },
              { key: "lastDone", label: "آخر تنفيذ", type: "date" },
            ]}
          />
          <p className="mt-2 text-xs text-gray-500">نفس المركبة واسم الصيانة مرة ثانية يحدّث الخطة القائمة بدل تكرارها.</p>
        </Card>
      </>
    );

  return (
    <>
      <PageHeader title="الصيانة" description={description}>
        <ListActions
          newHref={canUpdate && listHref(BASE, { ...listParams, open: undefined, new: "1" } as Params, {})}
          newLabel="خطة دورية جديدة"
          addHref={canUpdate && `${BASE}?add=1`}
          addLabel="إضافة خطط جماعية"
          importHref={canUpdate && "/import/maintenance-plans"}
        />
      </PageHeader>
      <MaintenanceTabs active="plans" />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "متأخرة", value: counts.overdue, status: "overdue", tone: "text-red-700" },
          { label: `مستحقة خلال ${PLAN_ALERT_DAYS} أيام`, value: counts.soon, status: "soon", tone: "text-amber-800" },
          { label: "كل الخطط النشطة", value: all.length, status: undefined, tone: "text-brand-900" },
        ].map((k) => (
          <Link key={k.label} href={listHref(BASE, sp, { status: k.status, open: undefined })} scroll={false} className="rounded-2xl bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow">
            <div className="text-xs text-gray-500">{k.label}</div>
            <div className={`ltr-nums mt-1 font-display text-xl font-semibold ${k.tone}`}>{k.value}</div>
          </Link>
        ))}
      </div>

      <DocToolbar base={BASE} params={sp} statuses={STATUSES} allStatuses="كل الاستحقاقات" pay={false} views={false} period={false} sorts={{}} noun="خطة" exportName="الصيانة-الدورية" count={plans.length} placeholder="ابحث باللوحة أو اسم الصيانة" />
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm print:hidden">
        {(["q", "status"] as const).map((k) => sp[k] && <input key={k} type="hidden" name={k} value={sp[k]} />)}
        <Select name="vehicle" defaultValue={sp.vehicle ?? ""} className="w-36">
          <option value="">كل المركبات</option>
          {vehicles.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select name="type" defaultValue={sp.type ?? ""} className="w-44">
          <option value="">كل الأنواع</option>
          {Object.entries(MAINTENANCE_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">تصفية</button>
      </form>

      {openPlan && (
        <section className="animate-flyout mb-6 rounded-2xl bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-3">
            <Link href={listHref(BASE, sp, { open: undefined })} scroll={false} aria-label="إغلاق" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
              <Icon name="close" className="size-4" />
            </Link>
            <span className="font-display text-lg font-semibold text-brand-900">
              {openPlan.title} · {openPlan.plate}
            </span>
            <span className="text-xs text-gray-500">
              {(openPlan.typeLabel ?? MAINTENANCE_TYPES[openPlan.type])} · كل {openPlan.intervalDays} يوم · الاستحقاق <span className="ltr-nums">{openPlan.due}</span>
            </span>
            {canUpdate && (
              <Link href={listHref(BASE, { ...listParams, edit: String(openPlan.id) } as Params, {})} scroll={false} className="ms-auto rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                تعديل الخطة
              </Link>
            )}
            {canCreate && !openByPlan.has(openPlan.id) && (
              <Link href={`/maintenance?new=1&vehicle=${openPlan.vehicleId}&plan=${openPlan.id}&type=${encodeURIComponent(joinCustom(openPlan.type, openPlan.typeClassId))}`} className={`${canUpdate ? "" : "ms-auto "}rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-brand-900 hover:bg-brand-500`}>
                إنشاء أمر صيانة
              </Link>
            )}
          </div>
          <div className="p-5">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">سجل التنفيذ</h3>
            <Table head={["الأمر", "التاريخ", "الإكمال", "الإجمالي", "الحالة"]}>
              {history.length === 0 && <EmptyRow cols={5}>لم يُنفذ أمر لهذه الخطة بعد</EmptyRow>}
              {history.map((h) => (
                <tr key={h.id}>
                  <Td>
                    <Link href={`/maintenance?open=${h.id}`} className="ltr-nums text-brand-700 hover:underline">
                      {h.number}
                    </Link>
                  </Td>
                  <Td className="ltr-nums">{h.orderDate}</Td>
                  <Td className="ltr-nums">{h.completedDate ?? "—"}</Td>
                  <Td className="ltr-nums">{fmt(h.total)}</Td>
                  <Td>
                    <Badge tone={MAINTENANCE_STATUS[h.status].tone}>{MAINTENANCE_STATUS[h.status].label}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </section>
      )}

      {selectable.length > 0 && (
        <ActionForm id={BULK_FORM} action={bulkPlanOrders} className="mb-3 flex flex-wrap items-end gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm">
          <SelectionTotal form={BULK_FORM} noun="خطة" />
          <Field label="تاريخ الأوامر">
            <Input type="date" name="date" defaultValue={today} className="w-40" />
          </Field>
          <SubmitButton variant="secondary">إنشاء أوامر صيانة للمحدد</SubmitButton>
          <span className="text-xs text-gray-400">يُنشأ أمر مسودة لكل خطة، تضيف بنوده ثم تعتمده.</span>
        </ActionForm>
      )}
      <Table head={[selectable.length ? <SelectAll key="all" form={BULK_FORM} /> : "", "المركبة", "الصيانة", "النوع", "كل", "آخر تنفيذ", "الاستحقاق", "الحالة", "أمر مفتوح", ""]}>
        {plans.length === 0 && <EmptyRow cols={10}>{all.length ? "لا توجد خطط بهذه الشروط" : "لا توجد خطط دورية بعد"}</EmptyRow>}
        {plans.map((p) => {
          const openOrder = openByPlan.get(p.id);
          return (
            <tr key={p.id} className={p.id === openId ? "bg-brand-50/70" : "transition hover:bg-brand-50/40"}>
              <Td>{selectable.some((x) => x.id === p.id) && <RowCheck form={BULK_FORM} id={p.id} amount="0" />}</Td>
              <Td className="font-medium">{p.plate}</Td>
              <Td>
                <Link href={listHref(BASE, sp, { open: String(p.id) })} scroll={false} className="text-brand-700 hover:underline">
                  {p.title}
                </Link>
              </Td>
              <Td>{(p.typeLabel ?? MAINTENANCE_TYPES[p.type])}</Td>
              <Td className="ltr-nums">{p.intervalDays} يوم</Td>
              <Td className="ltr-nums">{p.lastDoneDate ?? "—"}</Td>
              <Td className={`ltr-nums ${p.days < 0 ? "font-semibold text-red-600" : ""}`}>{p.due}</Td>
              <Td>
                {p.days < 0 ? (
                  <Badge tone="red">متأخرة {-p.days} يوم</Badge>
                ) : p.days <= PLAN_ALERT_DAYS ? (
                  <Badge tone="amber">{p.days === 0 ? "مستحقة اليوم" : `خلال ${p.days} يوم`}</Badge>
                ) : (
                  <Badge tone="green">بعد {p.days} يوم</Badge>
                )}
              </Td>
              <Td>
                {openOrder ? (
                  <Link href={`/maintenance?open=${openOrder.id}`} className="ltr-nums text-xs text-brand-700 hover:underline">
                    {openOrder.number} · {MAINTENANCE_STATUS[openOrder.status].label}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <Link href={listHref(BASE, sp, { open: String(p.id) })} scroll={false} aria-label="معاينة" className="inline-flex rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-700">
                  <Icon name="expand" className="size-4" />
                </Link>
              </Td>
            </tr>
          );
        })}
      </Table>
      {canUpdate && (sp.new === "1" || editId) && (
        <PlanPanel
          id={editId}
          closeHref={listHref(BASE, listParams as Params, {})}
          savedHref={listHref(BASE, listParams as Params, { open: "ID" }).replace("open=ID", "open={id}")}
        />
      )}
    </>
  );
}
