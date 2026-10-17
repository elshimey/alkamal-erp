import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { EXPIRY_ALERT_DAYS } from "@/lib/fleet";
import { ExpiryBadge } from "@/components/expiry-badge";
import { DOCUMENT_TYPES } from "@/data/fleet";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { addDocument } from "./actions";

export default async function FleetDocumentsPage() {
  const user = await requirePermission("fleet_documents", "view");
  const today = todayRiyadh();
  const [docs, vehicles, drivers] = await Promise.all([
    db
      .select({ doc: s.fleetDocuments, plate: s.vehicles.plate, driverName: s.employees.nameAr })
      .from(s.fleetDocuments)
      .leftJoin(s.vehicles, eq(s.vehicles.id, s.fleetDocuments.vehicleId))
      .leftJoin(s.drivers, eq(s.drivers.id, s.fleetDocuments.driverId))
      .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .orderBy(asc(s.fleetDocuments.expiryDate)),
    db.select({ id: s.vehicles.id, plate: s.vehicles.plate }).from(s.vehicles).orderBy(asc(s.vehicles.plate)),
    db
      .select({ id: s.drivers.id, name: s.employees.nameAr })
      .from(s.drivers)
      .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .orderBy(asc(s.employees.nameAr)),
  ]);

  return (
    <>
      <PageHeader title="وثائق الأسطول" description={`استمارات وتأمين وفحص ورخص وإقامات. يظهر التنبيه قبل ${EXPIRY_ALERT_DAYS} يوماً من الانتهاء.`} />
      {can(user.perms, "fleet_documents", "create") && (
        <Card title="إضافة وثيقة" className="mb-6">
          <ActionForm action={addDocument} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="صاحب الوثيقة *">
              <Select name="owner" required defaultValue="">
                <option value="" disabled>
                  اختر…
                </option>
                <optgroup label="المركبات">
                  {vehicles.map((v) => (
                    <option key={v.id} value={`v:${v.id}`}>
                      {v.plate}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="السائقون">
                  {drivers.map((d) => (
                    <option key={d.id} value={`d:${d.id}`}>
                      {d.name}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <Field label="النوع *">
              <Select name="type" required defaultValue="">
                <option value="" disabled>
                  اختر…
                </option>
                {Object.entries(DOCUMENT_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الرقم">
              <Input name="number" dir="ltr" />
            </Field>
            <Field label="الجهة">
              <Input name="authority" placeholder="المرور، شركة التأمين…" />
            </Field>
            <Field label="تاريخ الإصدار">
              <Input name="issueDate" type="date" />
            </Field>
            <Field label="تاريخ الانتهاء *">
              <Input name="expiryDate" type="date" required />
            </Field>
            <Field label="التكلفة">
              <Input name="cost" type="number" min={0} step="0.01" dir="ltr" />
            </Field>
            <div className="flex items-end">
              <SubmitButton>إضافة الوثيقة</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
      <Table head={["صاحب الوثيقة", "النوع", "الرقم", "الجهة", "الانتهاء", "الحالة"]}>
        {docs.length === 0 && <EmptyRow cols={6}>لا توجد وثائق بعد</EmptyRow>}
        {docs.map(({ doc, plate, driverName }) => (
          <tr key={doc.id}>
            <Td className="font-medium">{plate ?? driverName}</Td>
            <Td>{DOCUMENT_TYPES[doc.type]}</Td>
            <Td className="ltr-nums">{doc.number ?? "—"}</Td>
            <Td>{doc.authority ?? "—"}</Td>
            <Td className="ltr-nums">{doc.expiryDate}</Td>
            <Td>
              <ExpiryBadge expiryDate={doc.expiryDate} today={today} />
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
