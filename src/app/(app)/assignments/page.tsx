import { and, asc, desc, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { endAssignment, startAssignment } from "./actions";
import { AddModeBar, ListActions } from "@/components/list-actions";

const baseQuery = () =>
  db
    .select({ a: s.vehicleAssignments, plate: s.vehicles.plate, driver: s.employees.nameAr })
    .from(s.vehicleAssignments)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.vehicleAssignments.vehicleId))
    .innerJoin(s.drivers, eq(s.drivers.id, s.vehicleAssignments.driverId))
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId));

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
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
      .where(and(eq(s.vehicles.status, "active"), busyVehicles.length ? notInArray(s.vehicles.id, busyVehicles) : undefined))
      .orderBy(asc(s.vehicles.plate)),
    db
      .select({ id: s.drivers.id, name: s.employees.nameAr })
      .from(s.drivers)
      .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .where(and(eq(s.drivers.status, "active"), busyDrivers.length ? notInArray(s.drivers.id, busyDrivers) : undefined))
      .orderBy(asc(s.employees.nameAr)),
  ]);

  const adding = (await searchParams).add === "1" && !!(canEdit);
  return (
    <>
      <PageHeader title="الإسناد والتسليم" description="من يقود كل مركبة ومتى. منه يُعرف السائق وقت المخالفة، ويُحدَّث عداد المركبة.">
        {!adding && <ListActions newHref={(canEdit) && "/assignments?add=1"} newLabel="استلام مركبة" />}
      </PageHeader>
      {adding && <AddModeBar backHref="/assignments" backLabel="الإسناد والتسليم" title="استلام مركبة" />}
      {adding && (
        <Card className="mb-6">
          <ActionForm action={startAssignment} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <Field label="المركبة">
              <Select name="vehicleId" required defaultValue="">
                <option value="" disabled>
                  اختر…
                </option>
                {freeVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate} (العداد {v.odometer.toLocaleString("en")})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="السائق">
              <Select name="driverId" required defaultValue="">
                <option value="" disabled>
                  اختر…
                </option>
                {freeDrivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="تاريخ الاستلام">
              <Input name="fromDate" type="date" required defaultValue={today} />
            </Field>
            <Field label="قراءة العداد" hint="فارغ = آخر قراءة مسجلة">
              <Input name="odometerStart" type="number" min={0} dir="ltr" />
            </Field>
            <SubmitButton>تسجيل الاستلام</SubmitButton>
            <div className="col-span-full">
              <Field label="ملاحظات الحالة">
                <Input name="notes" />
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}
      {!adding && (
        <>      <h2 className="mb-3 font-semibold text-gray-800">المسندة حالياً</h2>
      <Table head={["المركبة", "السائق", "منذ", "عداد الاستلام", canEdit ? "تسجيل التسليم" : ""]}>
        {open.length === 0 && <EmptyRow cols={5}>لا توجد مركبات مسندة</EmptyRow>}
        {open.map(({ a, plate, driver }) => (
          <tr key={a.id}>
            <Td className="font-medium">{plate}</Td>
            <Td>{driver}</Td>
            <Td className="ltr-nums">{a.fromDate}</Td>
            <Td className="ltr-nums">{a.odometerStart?.toLocaleString("en") ?? "—"}</Td>
            <Td>
              {canEdit && (
                <ActionForm action={endAssignment.bind(null, a.id)} className="flex flex-wrap items-center gap-2">
                  <Input name="toDate" type="date" required defaultValue={today} className="w-36" aria-label="تاريخ التسليم" />
                  <Input name="odometerEnd" type="number" min={0} placeholder="العداد" dir="ltr" className="w-28" aria-label="عداد التسليم" />
                  <SubmitButton variant="secondary">تسليم</SubmitButton>
                </ActionForm>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      <h2 className="mt-8 mb-3 font-semibold text-gray-800">السجل</h2>
      <Table head={["المركبة", "السائق", "من", "إلى", "الكيلومترات"]}>
        {history.length === 0 && <EmptyRow cols={5}>لا يوجد سجل بعد</EmptyRow>}
        {history.map(({ a, plate, driver }) => (
          <tr key={a.id}>
            <Td>{plate}</Td>
            <Td>{driver}</Td>
            <Td className="ltr-nums">{a.fromDate}</Td>
            <Td className="ltr-nums">{a.toDate}</Td>
            <Td className="ltr-nums">
              {a.odometerEnd != null && a.odometerStart != null ? (a.odometerEnd - a.odometerStart).toLocaleString("en") : "—"}
            </Td>
          </tr>
        ))}
      </Table>
        </>
      )}
    </>
  );
}
