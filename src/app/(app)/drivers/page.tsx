import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { createDriverLoginAction, saveDrivers } from "./actions";

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
      login: s.users.login,
    })
    .from(s.drivers)
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .innerJoin(custody, eq(custody.id, s.drivers.custodyAccountId))
    .leftJoin(s.vehicleAssignments, and(eq(s.vehicleAssignments.driverId, s.drivers.id), isNull(s.vehicleAssignments.toDate)))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.vehicleAssignments.vehicleId))
    .leftJoin(s.users, eq(s.users.id, s.drivers.userId))
    .orderBy(asc(s.employees.nameAr));

  return (
    <>
      <PageHeader
        title="السائقون"
        description="كل سائق يُنشأ معه موظفه، وحساب عهدته تحت 1105، وحساب رواتبه المستحقة تحت 2107 تلقائياً."
      />
      {can(user.perms, "drivers", "create") && (
        <Card title="إدخال سائقين" className="mb-6">
          <SheetEditor
            templateName="السائقون"
            action={saveDrivers}
            columns={[
              { key: "nameAr", label: "الاسم", required: true, width: "12rem" },
              { key: "mobile", label: "الجوال", ltr: true },
              { key: "nationality", label: "الجنسية" },
              { key: "appLanguage", label: "لغة التطبيق", type: "select", options: Object.entries(LANG).map(([value, label]) => ({ value, label })) },
              { key: "nationalId", label: "الهوية", ltr: true },
              { key: "residencyNumber", label: "الإقامة", ltr: true },
              { key: "licenseNumber", label: "الرخصة", ltr: true },
              { key: "transportCardNumber", label: "بطاقة هيئة النقل", ltr: true },
              { key: "commissionClass", label: "فئة العمولة", type: "select", options: [{ value: "domestic", label: "داخلي" }, { value: "international", label: "خارجي" }] },
              { key: "hireDate", label: "تاريخ التعيين", type: "date" },
              { key: "basicSalary", label: "الراتب الأساسي", type: "number" },
              { key: "custodyLimit", label: "سقف العهدة", type: "number" },
            ]}
          />
        </Card>
      )}
      {can(user.perms, "users", "create") && rows.some((r) => !r.login) && (
        <Card title="حساب دخول لتطبيق السائق" className="mb-6">
          <p className="mb-4 text-sm text-gray-500">
            يدخل السائق بهذا الحساب من جواله على الرابط <a href="/driver" dir="ltr" className="font-medium text-brand-700 hover:underline" style={{ unicodeBidi: "isolate" }}>/driver</a>، ويرى رحلاته ومصاريفه وعهدته بلغته فقط. رابط الإرسال ورمز التطبيق في <a href="/settings/driver-app" className="font-medium text-brand-700 hover:underline">الإعدادات ← تطبيق السائق</a>.
          </p>
          <ActionForm action={createDriverLoginAction} className="grid items-end gap-4 sm:grid-cols-4">
            <Field label="السائق">
              <Select name="driverId" required defaultValue="">
                <option value="" disabled>
                  اختر السائق
                </option>
                {rows
                  .filter((r) => !r.login)
                  .map(({ d, name }) => (
                    <option key={d.id} value={d.id}>
                      {name}
                      {d.mobile ? ` (${d.mobile})` : ""}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="اسم الدخول" hint="الجوال مثلاً">
              <Input name="login" required dir="ltr" />
            </Field>
            <Field label="كلمة المرور" hint={`${MIN_PASSWORD_LENGTH} أحرف على الأقل`}>
              <Input name="password" type="text" required minLength={MIN_PASSWORD_LENGTH} dir="ltr" autoComplete="off" />
            </Field>
            <SubmitButton>إنشاء الحساب</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Table head={["الاسم", "الجوال", "الجنسية", "لغة التطبيق", "العمولة", "المركبة الحالية", "حساب العهدة", "دخول التطبيق", "الحالة"]}>
        {rows.length === 0 && <EmptyRow cols={9}>لا يوجد سائقون بعد</EmptyRow>}
        {rows.map(({ d, name, custodyCode, plate, login }) => (
          <tr key={d.id}>
            <Td className="font-medium">{name}</Td>
            <Td className="ltr-nums">{d.mobile ?? "—"}</Td>
            <Td>{d.nationality ?? "—"}</Td>
            <Td>{LANG[d.appLanguage]}</Td>
            <Td>{d.commissionClass === "domestic" ? "داخلي" : "خارجي"}</Td>
            <Td>{plate ?? <span className="text-gray-400">بلا مركبة</span>}</Td>
            <Td className="ltr-nums text-gray-500">{custodyCode}</Td>
            <Td className="ltr-nums">{login ?? <span className="text-gray-400">—</span>}</Td>
            <Td>
              <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
