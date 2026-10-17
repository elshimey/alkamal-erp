import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, Table, Td } from "@/components/ui";
import { createUser, setUserActive } from "./actions";

export default async function UsersPage() {
  const me = await requirePermission("users", "view");
  const [users, roles, links] = await Promise.all([
    db.select().from(s.users).orderBy(asc(s.users.name)),
    db.select().from(s.roles).orderBy(asc(s.roles.id)),
    db
      .select({ userId: s.userRoles.userId, nameAr: s.roles.nameAr })
      .from(s.userRoles)
      .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)),
  ]);
  const canUpdate = can(me.perms, "users", "update");

  return (
    <>
      <PageHeader title="المستخدمون" description="حتى 50 مستخدماً من الموظفين والسائقين. لكل مستخدم دور أو أكثر." />
      {can(me.perms, "users", "create") && (
        <Card title="مستخدم جديد" className="mb-6">
          <ActionForm action={createUser} className="grid gap-4 sm:grid-cols-3">
            <Field label="الاسم">
              <Input name="name" required />
            </Field>
            <Field label="اسم الدخول (الجوال أو البريد)">
              <Input name="login" required dir="ltr" autoComplete="off" />
            </Field>
            <Field label="كلمة المرور الأولى" hint={`${MIN_PASSWORD_LENGTH} أحرف على الأقل، ويغيّرها المستخدم من صفحة حسابه`}>
              <Input name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} dir="ltr" autoComplete="new-password" />
            </Field>
            <fieldset className="col-span-full">
              <legend className="mb-2 text-sm font-medium text-gray-700">الأدوار</legend>
              <div className="flex flex-wrap gap-4">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="roleIds" value={r.id} className="size-4" />
                    {r.nameAr}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="col-span-full">
              <SubmitButton>إنشاء المستخدم</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
      <Table head={["الاسم", "اسم الدخول", "الأدوار", "آخر دخول", "الحالة", ""]}>
        {users.map((u) => (
          <tr key={u.id}>
            <Td className="font-medium">{u.name}</Td>
            <Td className="ltr-nums text-gray-600">{u.login}</Td>
            <Td>
              <div className="flex flex-wrap gap-1">
                {links
                  .filter((l) => l.userId === u.id)
                  .map((l) => (
                    <Badge key={l.nameAr} tone="blue">
                      {l.nameAr}
                    </Badge>
                  ))}
              </div>
            </Td>
            <Td className="ltr-nums text-xs text-gray-500">{u.lastLoginAt?.toLocaleString("en-GB") ?? "—"}</Td>
            <Td>{u.isActive ? <Badge tone="green">نشط</Badge> : <Badge tone="red">موقوف</Badge>}</Td>
            <Td>
              {canUpdate && u.id !== me.id && (
                <form action={setUserActive.bind(null, u.id, !u.isActive)}>
                  <button className="text-xs text-brand-700 hover:underline">{u.isActive ? "إيقاف" : "تفعيل"}</button>
                </form>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
