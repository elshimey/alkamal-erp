import Link from "next/link";
import { EditLink } from "@/components/edit-link";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { saveEmployees } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { maximumFractionDigits: 2 });
const STATUS = { active: { label: "على رأس العمل", tone: "green" }, on_leave: { label: "إجازة", tone: "amber" }, terminated: { label: "منتهية خدمته", tone: "gray" } } as const;
const YES_NO = [
  { value: "yes", label: "نعم" },
  { value: "no", label: "لا" },
];

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const user = await requirePermission("employees", "view");
  const canCreate = can(user.perms, "employees", "create");
  const adding = (await searchParams).add === "1" && canCreate;
  const rows = await db
    .select({ e: s.employees, driverId: s.drivers.id, account: s.accounts.code })
    .from(s.employees)
    .leftJoin(s.drivers, eq(s.drivers.employeeId, s.employees.id))
    .leftJoin(s.accounts, eq(s.accounts.id, s.employees.payableAccountId))
    .orderBy(asc(s.employees.status), asc(s.employees.nameAr));

  return (
    <>
      <PageHeader
        title="الموظفون"
        description="بيانات الرواتب لكل موظف: الأساسي والسكن والبدلات والتأمينات والآيبان. السائق يُضاف من شاشة السائقين ويظهر هنا لاستكمال راتبه. لتحديث الرواتب دفعة واحدة استخدم «تعديل جماعي»."
      >
        {!adding && <ListActions bulkHref={can(user.perms, "employees", "update") && "/records/employees/bulk"} addHref={canCreate && "/employees?add=1"} />}
      </PageHeader>
      {adding && <AddModeBar backHref="/employees" backLabel="الموظفون" title="إضافة جماعية" />}
      <div className={adding ? "mb-6 space-y-6" : "hidden"}>
        {adding && (
          <Card title="إضافة موظفين">
            <SheetEditor
              templateName="الموظفون"
              action={saveEmployees}
              initialRows={3}
              columns={[
                { key: "nameAr", label: "الاسم", required: true, width: "11rem" },
                { key: "jobTitle", label: "الوظيفة", width: "8rem" },
                { key: "nationalId", label: "الهوية / الإقامة", ltr: true, width: "8rem" },
                { key: "hireDate", label: "تاريخ التعيين", type: "date" },
                { key: "basicSalary", label: "الأساسي", type: "number", width: "6rem" },
                { key: "housingAllowance", label: "السكن", type: "number", width: "6rem" },
                { key: "allowances", label: "بدلات أخرى", type: "number", width: "6rem" },
                { key: "isSaudi", label: "سعودي", type: "select", options: YES_NO, width: "5rem", placeholder: "لا" },
                { key: "gosiSubject", label: "بالتأمينات", type: "select", options: YES_NO, width: "5rem", placeholder: "نعم" },
                { key: "bankName", label: "البنك", width: "7rem" },
                { key: "iban", label: "الآيبان", ltr: true, width: "13rem" },
              ]}
            />
          </Card>
        )}
      </div>
      {!adding && (
      <Table head={["الموظف", "الوظيفة", "التعيين", "الأساسي", "السكن", "بدلات أخرى", "الإجمالي", "التأمينات", "الآيبان", "الحالة"]}>
        {rows.length === 0 && <EmptyRow cols={10}>لا يوجد موظفون بعد</EmptyRow>}
        {rows.map(({ e, driverId, account }) => {
          const total = Number(e.basicSalary) + Number(e.housingAllowance) + Number(e.allowances);
          return (
            <tr key={e.id}>
              <Td className="font-medium">
                {e.nameAr}
                <EditLink href={driverId ? `/drivers/${driverId}` : `/records/employees/${e.id}`} />
                <Link href={driverId ? `/fleet-documents/owner/driver-${driverId}` : `/fleet-documents/owner/employee-${e.id}`} className="ms-2 text-xs font-normal text-gray-500 hover:text-brand-700 hover:underline">
                  الوثائق
                </Link>
                <div className="ltr-nums text-xs font-normal text-gray-500">{account}</div>
              </Td>
              <Td>
                {e.jobTitle ?? "—"}
                {driverId && <Badge tone="blue">سائق</Badge>}
              </Td>
              <Td className="ltr-nums whitespace-nowrap">{e.hireDate ?? "—"}</Td>
              <Td className="ltr-nums">{fmt(e.basicSalary)}</Td>
              <Td className="ltr-nums">{fmt(e.housingAllowance)}</Td>
              <Td className="ltr-nums">{fmt(e.allowances)}</Td>
              <Td className={`ltr-nums font-medium ${total === 0 ? "text-amber-700" : ""}`}>{total === 0 ? "لم يُحدد" : fmt(total)}</Td>
              <Td>{!e.gosiSubject ? "غير مسجل" : e.isSaudi ? "سعودي" : "غير سعودي"}</Td>
              <Td className="ltr-nums text-xs">{e.iban ?? <span className="text-amber-700">بلا آيبان</span>}</Td>
              <Td>
                <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
              </Td>
            </tr>
          );
        })}
      </Table>
      )}
    </>
  );
}
