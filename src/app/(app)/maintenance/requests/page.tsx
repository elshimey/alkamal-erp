import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { driverOptions, vehicleOptions } from "@/lib/lookups";
import { todayRiyadh } from "@/lib/dates";
import { BREAKDOWN_APPROVAL_LIMIT, BREAKDOWN_STATUS, PRIORITIES } from "@/data/maintenance";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, Input, PageHeader, Table, Td } from "@/components/ui";
import { MaintenanceTabs } from "../tabs";
import { approveRequest, rejectRequest, reviewRequest, saveRequests } from "../actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { maximumFractionDigits: 2 });

export default async function BreakdownRequestsPage() {
  const user = await requirePermission("maintenance", "view");
  const [vehicles, drivers, list] = await Promise.all([
    vehicleOptions(),
    driverOptions(),
    db
      .select({ r: s.breakdownRequests, plate: s.vehicles.plate, driver: s.employees.nameAr, order: s.maintenanceOrders })
      .from(s.breakdownRequests)
      .innerJoin(s.vehicles, eq(s.vehicles.id, s.breakdownRequests.vehicleId))
      .leftJoin(s.drivers, eq(s.drivers.id, s.breakdownRequests.driverId))
      .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .leftJoin(s.maintenanceOrders, eq(s.maintenanceOrders.breakdownRequestId, s.breakdownRequests.id))
      .orderBy(desc(s.breakdownRequests.reportDate), desc(s.breakdownRequests.id))
      .limit(300),
  ]);
  const canReview = can(user.perms, "maintenance", "update");
  const canApprove = can(user.perms, "maintenance", "approve");

  return (
    <>
      <PageHeader title="الصيانة" description={`بلاغ العطل من السائق أو المكتب. يراجعه المشرف ويعتمده إن كانت تكلفته حتى ${BREAKDOWN_APPROVAL_LIMIT.toLocaleString("en")} ر.س، وما فوقها يعتمده المدير، ثم يتحول إلى أمر صيانة.`} />
      <MaintenanceTabs active="requests" />
      {can(user.perms, "maintenance", "create") && (
        <Card title="تسجيل بلاغات عطل" className="mb-6">
          <SheetEditor
            templateName="طلبات العطل"
            action={saveRequests}
            initialRows={3}
            columns={[
              { key: "date", label: "التاريخ", type: "date", placeholder: todayRiyadh() },
              { key: "vehicleId", label: "المركبة", type: "select", required: true, options: vehicles, width: "9rem" },
              { key: "driverId", label: "السائق", type: "select", options: drivers, width: "10rem" },
              { key: "description", label: "وصف العطل", required: true, width: "20rem" },
              { key: "priority", label: "الأولوية", type: "select", options: Object.entries(PRIORITIES).map(([value, p]) => ({ value, label: p.label })), width: "7rem", placeholder: "عادية" },
              { key: "estimatedCost", label: "التكلفة التقديرية", type: "number", width: "8rem" },
            ]}
          />
        </Card>
      )}
      <Table head={["الرقم", "التاريخ", "المركبة", "العطل", "الأولوية", "التكلفة التقديرية", "الحالة", ""]}>
        {list.length === 0 && <EmptyRow cols={8}>لا توجد طلبات عطل</EmptyRow>}
        {list.map(({ r, plate, driver, order }) => (
          <tr key={r.id}>
            <Td className="ltr-nums font-medium whitespace-nowrap">{r.number}</Td>
            <Td className="ltr-nums whitespace-nowrap">{r.reportDate}</Td>
            <Td className="font-medium">
              {plate}
              {driver && <div className="text-xs font-normal text-gray-500">{driver}</div>}
            </Td>
            <Td>
              {r.description}
              {r.rejectReason && <div className="text-xs text-red-600">سبب الرفض: {r.rejectReason}</div>}
            </Td>
            <Td>
              <Badge tone={PRIORITIES[r.priority].tone}>{PRIORITIES[r.priority].label}</Badge>
            </Td>
            <Td className="ltr-nums">{r.estimatedCost != null ? fmt(r.estimatedCost) : "—"}</Td>
            <Td>
              <Badge tone={BREAKDOWN_STATUS[r.status].tone}>{BREAKDOWN_STATUS[r.status].label}</Badge>
              {order && (
                <Link href={`/maintenance/${order.id}`} className="ltr-nums mt-1 block text-xs text-brand-700 hover:underline">
                  {order.number}
                </Link>
              )}
            </Td>
            <Td>
              <div className="flex flex-wrap gap-2">
                {r.status === "pending_supervisor" && canReview && (
                  <ActionForm action={reviewRequest.bind(null, r.id)} resetOnSuccess={false} className="flex gap-1">
                    {r.estimatedCost == null && <Input name="estimatedCost" type="number" min={0} placeholder="التكلفة" className="w-24" />}
                    <SubmitButton variant="secondary">مراجعة المشرف</SubmitButton>
                  </ActionForm>
                )}
                {r.status === "pending_approval" && canApprove && (
                  <ActionForm action={approveRequest.bind(null, r.id)} resetOnSuccess={false}>
                    <SubmitButton>اعتماد المدير</SubmitButton>
                  </ActionForm>
                )}
                {r.status === "approved" && !order && can(user.perms, "maintenance", "create") && (
                  <Link href={`/maintenance?vehicle=${r.vehicleId}&request=${r.id}`} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-brand-900 hover:bg-brand-500">
                    إنشاء أمر صيانة
                  </Link>
                )}
                {["pending_supervisor", "pending_approval", "approved"].includes(r.status) && !order && canReview && (
                  <ActionForm action={rejectRequest.bind(null, r.id)} className="flex gap-1">
                    <Input name="reason" placeholder="سبب الرفض" className="w-28" />
                    <SubmitButton variant="secondary">رفض</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
