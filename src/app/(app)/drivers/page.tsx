import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { addDriver } from "./actions";

const LANG = { ar: "عربي", ur: "أوردو", hi: "هندي", en: "إنجليزي" } as const;
const STATUS = {
  active: { label: "نشط", tone: "green" },
  on_leave: { label: "إجازة", tone: "amber" },
  terminated: { label: "منتهية خدمته", tone: "red" },
} as const;

export default async function DriversPage() {
  const user = await requirePermission("drivers", "view");
  const custody = alias(s.accounts, "custody");
  const rows = await db
    .select({
      d: s.drivers,
      name: s.employees.nameAr,
      custodyCode: custody.code,
      plate: s.vehicles.plate,
    })
    .from(s.drivers)
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .innerJoin(custody, eq(custody.id, s.drivers.custodyAccountId))
    .leftJoin(s.vehicleAssignments, and(eq(s.vehicleAssignments.driverId, s.drivers.id), isNull(s.vehicleAssignments.toDate)))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.vehicleAssignments.vehicleId))
    .orderBy(asc(s.employees.nameAr));

  return (
    <>
      <PageHeader
        title="السائقون"
        description="كل سائق يُنشأ معه موظفه، وحساب عهدته تحت 1105، وحساب رواتبه المستحقة تحت 2107 تلقائياً."
      />
      {can(user.perms, "drivers", "create") && (
        <Card title="إضافة سائق" className="mb-6">
          <ActionForm action={addDriver} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="الاسم *">
              <Input name="nameAr" required />
            </Field>
            <Field label="الجوال">
              <Input name="mobile" dir="ltr" />
            </Field>
            <Field label="الجنسية">
              <Input name="nationality" />
            </Field>
            <Field label="لغة التطبيق">
              <Select name="appLanguage" defaultValue="ar">
                {Object.entries(LANG).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="رقم الهوية">
              <Input name="nationalId" dir="ltr" />
            </Field>
            <Field label="رقم الإقامة">
              <Input name="residencyNumber" dir="ltr" />
            </Field>
            <Field label="رقم الرخصة">
              <Input name="licenseNumber" dir="ltr" />
            </Field>
            <Field label="بطاقة هيئة النقل">
              <Input name="transportCardNumber" dir="ltr" />
            </Field>
            <Field label="فئة العمولة">
              <Select name="commissionClass" defaultValue="domestic">
                <option value="domestic">داخلي</option>
                <option value="international">خارجي</option>
              </Select>
            </Field>
            <Field label="تاريخ التعيين">
              <Input name="hireDate" type="date" />
            </Field>
            <Field label="الراتب الأساسي">
              <Input name="basicSalary" type="number" min={0} step="0.01" dir="ltr" />
            </Field>
            <Field label="سقف العهدة">
              <Input name="custodyLimit" type="number" min={0} step="0.01" dir="ltr" />
            </Field>
            <div className="col-span-full">
              <SubmitButton>إضافة السائق</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
      <Table head={["الاسم", "الجوال", "الجنسية", "لغة التطبيق", "العمولة", "المركبة الحالية", "حساب العهدة", "الحالة"]}>
        {rows.length === 0 && <EmptyRow cols={8}>لا يوجد سائقون بعد</EmptyRow>}
        {rows.map(({ d, name, custodyCode, plate }) => (
          <tr key={d.id}>
            <Td className="font-medium">{name}</Td>
            <Td className="ltr-nums">{d.mobile ?? "—"}</Td>
            <Td>{d.nationality ?? "—"}</Td>
            <Td>{LANG[d.appLanguage]}</Td>
            <Td>{d.commissionClass === "domestic" ? "داخلي" : "خارجي"}</Td>
            <Td>{plate ?? <span className="text-gray-400">بلا مركبة</span>}</Td>
            <Td className="ltr-nums text-gray-500">{custodyCode}</Td>
            <Td>
              <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
