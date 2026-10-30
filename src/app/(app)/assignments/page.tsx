import { and, asc, desc, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can, hasSpecial } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import Link from "next/link";
import { EmptyRow, Input, PageHeader, Table, Td } from "@/components/ui";
import { ListActions } from "@/components/list-actions";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { AssignmentFields } from "./assignment-fields";
import { endAssignmentAction, handoverAssignmentAction, startAssignmentAction } from "./actions";

const baseQuery = () =>
  db
    .select({ a: s.vehicleAssignments, plate: s.vehicles.plate, odometer: s.vehicles.odometer, driver: s.employees.nameAr })
    .from(s.vehicleAssignments)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.vehicleAssignments.vehicleId))
    .innerJoin(s.drivers, eq(s.drivers.id, s.vehicleAssignments.driverId))
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId));

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ new?: string; release?: string; handover?: string }> }) {
  const user = await requirePermission("vehicles", "view");
  const canEdit = can(user.perms, "vehicles", "update");
  const today = todayRiyadh();

  const open = await baseQuery().where(isNull(s.vehicleAssignments.toDate)).orderBy(asc(s.vehicles.plate));
  const history = await baseQuery()
    .where(isNotNull(s.vehicleAssignments.toDate))
    .orderBy(desc(s.vehicleAssignments.toDate))
    .limit(50);
  const busyVehicles = open.map((o) => o.a.vehicleId);
  const busyDrivers = open.map((o) => o.a.driverId);
  const [freeVehicles, freeDrivers] = await Promise.all([
    db
      .select({ id: s.vehicles.id, plate: s.vehicles.plate, odometer: s.vehicles.odometer })
      .from(s.vehicles)
      .where(and(eq(s.vehicles.status, "active"), eq(s.vehicles.assetKind, "head"), busyVehicles.length ? notInArray(s.vehicles.id, busyVehicles) : undefined))
      .orderBy(asc(s.vehicles.plate)),
    db
      .select({ id: s.drivers.id, name: s.employees.nameAr })
      .from(s.drivers)
      .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .where(and(eq(s.drivers.status, "active"), busyDrivers.length ? notInArray(s.drivers.id, busyDrivers) : undefined))
      .orderBy(asc(s.employees.nameAr)),
  ]);

  const sp = await searchParams;
  const creating = sp.new === "1" && canEdit;
  const releasing = canEdit ? open.find((o) => o.a.id === Number(sp.release)) : undefined;
  const handing = canEdit ? open.find((o) => o.a.id === Number(sp.handover)) : undefined;
  const driverOpts = freeDrivers.map((d) => ({ value: String(d.id), label: d.name }));
  const notesField = (
    <PanelSection title="ملاحظات الحالة" optional hint="حالة المركبة عند الاستلام أو التسليم">
      <PanelField label="ملاحظات">
        <textarea name="notes" rows={3} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
      </PanelField>
    </PanelSection>
  );

  return (
    <>
      <PageHeader title="الإسناد والتسليم" description="من يقود كل مركبة ومتى. منه يُعرف السائق وقت المخالفة، ويُحدَّث عداد المركبة.">
        <ListActions newHref={canEdit && "/assignments?new=1"} newLabel="استلام مركبة" />
      </PageHeader>
      <h2 className="mb-3 font-semibold text-gray-800">المسندة حالياً</h2>
      <Table head={["المركبة", "السائق", "منذ", "عداد الاستلام", ""]}>
        {open.length === 0 && <EmptyRow cols={5}>لا توجد مركبات مسندة</EmptyRow>}
        {open.map(({ a, plate, driver }) => (
          <tr key={a.id}>
            <Td className="font-medium">{plate}</Td>
            <Td>{driver}</Td>
            <Td className="ltr-nums">{a.fromDate}</Td>
            <Td className="ltr-nums">{a.odometerStart?.toLocaleString("en") ?? "—"}</Td>
            <Td>
              {canEdit && (
                <span className="flex flex-wrap gap-2">
                  <Link href={`/assignments?release=${a.id}`} scroll={false} prefetch={false} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
                    تسليم للشركة
                  </Link>
                  <Link href={`/assignments?handover=${a.id}`} scroll={false} prefetch={false} className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-900 shadow-sm hover:bg-brand-100">
                    تسليم لسائق آخر
                  </Link>
                </span>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      <h2 className="mt-8 mb-3 font-semibold text-gray-800">السجل</h2>
      <Table head={["المركبة", "السائق", "من", "إلى", "الكيلومترات", "ملاحظات"]}>
        {history.length === 0 && <EmptyRow cols={6}>لا يوجد سجل بعد</EmptyRow>}
        {history.map(({ a, plate, driver }) => (
          <tr key={a.id}>
            <Td>{plate}</Td>
            <Td>{driver}</Td>
            <Td className="ltr-nums">{a.fromDate}</Td>
            <Td className="ltr-nums">{a.toDate}</Td>
            <Td className="ltr-nums">
              {a.odometerEnd != null && a.odometerStart != null ? (a.odometerEnd - a.odometerStart).toLocaleString("en") : "—"}
            </Td>
            <Td className="text-xs text-gray-500">{a.notes ?? ""}</Td>
          </tr>
        ))}
      </Table>

      {creating && (
        <RecordPanel title="استلام مركبة" subtitle="يُسند الرأس للسائق من تاريخ الاستلام حتى تسجيل التسليم" closeHref="/assignments" action={startAssignmentAction} creating>
          <PanelSection title="الاستلام">
            <AssignmentFields
              vehicles={freeVehicles.map((v) => ({ value: String(v.id), label: v.plate }))}
              drivers={driverOpts}
              odometers={Object.fromEntries(freeVehicles.map((v) => [String(v.id), v.odometer]))}
              today={today}
              canOverride={hasSpecial(user.perms, "override_controls")}
            />
          </PanelSection>
          {notesField}
        </RecordPanel>
      )}
      {handing && (
        <RecordPanel
          title={`تسليم ${handing.plate} لسائق آخر`}
          subtitle={`من ${handing.driver} · منذ ${handing.a.fromDate}. يُسجَّل التسليم والاستلام معاً بالتاريخ والعداد نفسيهما`}
          closeHref="/assignments"
          action={handoverAssignmentAction.bind(null, handing.a.id)}
          creating={false}
        >
          <PanelSection title="التسليم والاستلام">
            <AssignmentFields
              vehicles={[]}
              drivers={driverOpts}
              odometers={{ [String(handing.a.vehicleId)]: Math.max(handing.a.odometerStart ?? 0, handing.odometer ?? 0) }}
              today={today}
              canOverride={hasSpecial(user.perms, "override_controls")}
              handover={{ vehicleId: handing.a.vehicleId, minDate: handing.a.fromDate }}
            />
          </PanelSection>
          {notesField}
        </RecordPanel>
      )}
      {releasing && (
        <RecordPanel title={`تسليم ${releasing.plate} للشركة`} subtitle={`${releasing.driver} · منذ ${releasing.a.fromDate}`} closeHref="/assignments" action={endAssignmentAction.bind(null, releasing.a.id)} creating={false}>
          <PanelSection title="التسليم">
            <PanelField label="تاريخ التسليم" required>
              <Input type="date" name="toDate" defaultValue={today} min={releasing.a.fromDate} required className="w-full" />
            </PanelField>
            <PanelField label="قراءة العداد" hint={releasing.a.odometerStart != null ? `عداد الاستلام ${releasing.a.odometerStart.toLocaleString("en")}` : undefined}>
              <Input name="odometerEnd" type="number" min={releasing.a.odometerStart ?? 0} dir="ltr" className="w-full" />
            </PanelField>
          </PanelSection>
          {notesField}
        </RecordPanel>
      )}
    </>
  );
}
