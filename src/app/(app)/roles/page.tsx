import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { createRole } from "./actions";

export default async function RolesPage() {
  const me = await requirePermission("roles", "view");
  const roles = await db
    .select({
      role: s.roles,
      users: sql<number>`(select count(*)::int from user_roles ur where ur.role_id = ${s.roles.id})`,
      perms: sql<number>`(select count(*)::int from role_permissions rp where rp.role_id = ${s.roles.id})`,
    })
    .from(s.roles)
    .orderBy(sql`${s.roles.isSystem} desc`, asc(s.roles.id));

  return (
    <>
      <PageHeader title="الأدوار والصلاحيات" description="الأدوار الأساسية ثابتة. أنشئ أدواراً مخصصة (مثل موظف التشغيل أو مشرف الصيانة) واختر صلاحياتها من المصفوفة." />
      {can(me.perms, "roles", "create") && (
        <Card title="دور مخصص جديد" className="mb-6">
          <ActionForm action={createRole} className="grid gap-4 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
            <Field label="اسم الدور">
              <Input name="nameAr" required placeholder="موظف التشغيل" />
            </Field>
            <Field label="ابدأ بنسخة من">
              <Select name="copyFrom" defaultValue="">
                <option value="">دور فارغ</option>
                {roles
                  .filter((r) => r.role.key !== "admin")
                  .map((r) => (
                    <option key={r.role.id} value={r.role.id}>
                      {r.role.nameAr}
                    </option>
                  ))}
              </Select>
            </Field>
            <SubmitButton>إنشاء</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Table head={["الدور", "النوع", "الوصف", "المستخدمون", "الصلاحيات"]}>
        {roles.map(({ role, users, perms }) => (
          <tr key={role.id}>
            <Td className="font-medium">
              <Link href={`/roles/${role.id}`} className="text-brand-700 hover:underline">
                {role.nameAr}
              </Link>
            </Td>
            <Td>{role.isSystem ? <Badge tone="blue">أساسي</Badge> : <Badge>مخصص</Badge>}</Td>
            <Td className="max-w-md text-xs text-gray-500">{role.description}</Td>
            <Td className="ltr-nums">{users}</Td>
            <Td className="ltr-nums">{role.key === "admin" ? "الكل" : perms}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
