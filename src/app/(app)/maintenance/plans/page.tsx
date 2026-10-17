import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { vehicleOptions } from "@/lib/lookups";
import { planSchedule } from "@/lib/maintenance";
import { todayRiyadh } from "@/lib/dates";
import { MAINTENANCE_TYPES, PLAN_ALERT_DAYS } from "@/data/maintenance";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { MaintenanceTabs } from "../tabs";
import { savePlans } from "../actions";

export default async function PlansPage() {
  const user = await requirePermission("maintenance", "view");
  const today = todayRiyadh();
  const [vehicles, plans] = await Promise.all([vehicleOptions(), planSchedule(db, today)]);

  return (
    <>
      <PageHeader title="الصيانة" description={`خطة دورية لكل مركبة بالمدة (بالأيام). تظهر في التنبيهات قبل موعدها بـ ${PLAN_ALERT_DAYS} أيام، وإكمال أمر صيانة مرتبط بها يحدّث آخر تنفيذ.`} />
      <MaintenanceTabs active="plans" />
      {can(user.perms, "maintenance", "update") && (
        <Card title="إضافة أو تعديل خطط" className="mb-6">
          <SheetEditor
            templateName="الصيانة الدورية"
            action={savePlans}
            initialRows={3}
            columns={[
              { key: "vehicleId", label: "المركبة", type: "select", required: true, options: vehicles, width: "9rem" },
              { key: "type", label: "النوع", type: "select", required: true, options: Object.entries(MAINTENANCE_TYPES).map(([value, label]) => ({ value, label })), width: "11rem" },
              { key: "title", label: "اسم الصيانة", required: true, width: "14rem", placeholder: "تغيير زيت" },
              { key: "intervalDays", label: "كل (يوم)", type: "number", required: true, width: "6rem", placeholder: "30" },
              { key: "lastDone", label: "آخر تنفيذ", type: "date" },
            ]}
          />
          <p className="mt-2 text-xs text-gray-500">إدخال نفس المركبة واسم الصيانة مرة ثانية يعدّل الخطة القائمة.</p>
        </Card>
      )}
      <Table head={["المركبة", "الصيانة", "النوع", "كل", "آخر تنفيذ", "الاستحقاق", "الحالة", ""]}>
        {plans.length === 0 && <EmptyRow cols={8}>لا توجد خطط دورية بعد</EmptyRow>}
        {plans.map((p) => (
          <tr key={p.id}>
            <Td className="font-medium">{p.plate}</Td>
            <Td>{p.title}</Td>
            <Td>{MAINTENANCE_TYPES[p.type]}</Td>
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
              {can(user.perms, "maintenance", "create") && p.days <= PLAN_ALERT_DAYS && (
                <Link href={`/maintenance?vehicle=${p.vehicleId}&plan=${p.id}&type=${p.type}`} className="text-sm text-brand-700 hover:underline">
                  إنشاء أمر
                </Link>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
