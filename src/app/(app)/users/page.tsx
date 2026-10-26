import { EditLink } from "@/components/edit-link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { PasswordInput } from "@/components/password-input";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { createUser, linkDriverAccount, setUserActive, setUserTrial } from "./actions";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { currentSchema } from "@/db/tenant";
import { AccessRequests } from "./access-requests";

const daysLeft = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86_400_000);

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const me = await requirePermission("users", "view");
  const [users, roles, links, drivers] = await Promise.all([
    db.select().from(s.users).orderBy(asc(s.users.name)),
    db.select().from(s.roles).orderBy(asc(s.roles.id)),
    db
      .select({ userId: s.userRoles.userId, nameAr: s.roles.nameAr, key: s.roles.key })
      .from(s.userRoles)
      .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)),
    db
      .select({ id: s.drivers.id, userId: s.drivers.userId, name: s.employees.nameAr, mobile: s.drivers.mobile })
      .from(s.drivers)
      .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .orderBy(asc(s.employees.nameAr)),
  ]);
  const freeDrivers = drivers.filter((d) => !d.userId);
  const driverOf = (userId: number) => drivers.find((d) => d.userId === userId);
  // حسابات بدور سائق غير مربوطة بسائق: لا تعمل في تطبيق السائق
  const unlinked = users.filter((u) => links.some((l) => l.userId === u.id && l.key === "driver") && !driverOf(u.id));
  const canUpdate = can(me.perms, "users", "update");

  const adding = (await searchParams).add === "1" && !!(can(me.perms, "users", "create"));
  return (
    <>
      <PageHeader title="المستخدمون" description="حتى 50 مستخدماً من الموظفين والسائقين. لكل مستخدم دور أو أكثر.">
        {!adding && <ListActions newHref={(can(me.perms, "users", "create")) && "/users?add=1"} newLabel="مستخدم جديد" />}
      </PageHeader>
      {!adding && canUpdate && <AccessRequests schema={await currentSchema()} />}
      {adding && <AddModeBar backHref="/users" backLabel="المستخدمون" title="مستخدم جديد" />}
      {adding && (
        <Card className="mb-6">
          <ActionForm action={createUser} className="grid gap-4 sm:grid-cols-3">
            <Field label="الاسم">
              <Input name="name" required />
            </Field>
            <Field label="اسم الدخول (الجوال أو البريد)">
              <Input name="login" required dir="ltr" autoComplete="off" />
            </Field>
            <Field label="كلمة المرور الأولى" hint={`${MIN_PASSWORD_LENGTH} أحرف على الأقل، ويغيّرها المستخدم من صفحة حسابه`}>
              <PasswordInput name="password" required minLength={MIN_PASSWORD_LENGTH} dir="ltr" autoComplete="new-password" />
            </Field>
            <Field label="نوع الحساب" hint="التجريبي يتوقف دخوله تلقائياً بعد المدة، ويمكن تمديده أو جعله دائماً">
              <select name="trialDays" defaultValue="0" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="0">دائم</option>
                <option value="15">تجريبي 15 يوماً</option>
                <option value="30">تجريبي 30 يوماً</option>
              </select>
            </Field>
            <Field label="ربط بسائق" hint="إلزامي لحساب السائق؛ والأسهل إنشاؤه من شاشة السائقين">
              <Select name="driverId" defaultValue="">
                <option value="">— ليس سائقاً —</option>
                {freeDrivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.mobile ? ` (${d.mobile})` : ""}
                  </option>
                ))}
              </Select>
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
      {!adding && (
        <>      {canUpdate && unlinked.length > 0 && (
        <Card title="حسابات سائقين غير مربوطة بسائق" className="mb-6 border-amber-300">
          <p className="mb-4 text-sm text-amber-800">
            هذه الحسابات بدور «سائق» لكنها غير مربوطة بأي سائق، فيظهر لصاحبها في التطبيق أن حسابه غير مربوط. اربط كل حساب بسائقه:
          </p>
          <ActionForm action={linkDriverAccount} className="grid items-end gap-4 sm:grid-cols-3">
            <Field label="الحساب">
              <Select name="userId" required defaultValue="">
                <option value="" disabled>
                  اختر الحساب
                </option>
                {unlinked.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.login})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="السائق">
              <Select name="driverId" required defaultValue="">
                <option value="" disabled>
                  اختر السائق
                </option>
                {freeDrivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton>ربط</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Table head={["الاسم", "اسم الدخول", "الأدوار", "آخر دخول", "الحالة", ""]}>
        {users.map((u) => (
          <tr key={u.id}>
            <Td className="font-medium">
              {u.name}
              <EditLink href={`/records/users/${u.id}`} />
            </Td>
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
                {driverOf(u.id) ? (
                  <span className="text-xs text-gray-500">← {driverOf(u.id)!.name}</span>
                ) : (
                  unlinked.includes(u) && <Badge tone="red">غير مربوط بسائق</Badge>
                )}
              </div>
            </Td>
            <Td className="ltr-nums text-xs text-gray-500">{u.lastLoginAt?.toLocaleString("en-GB") ?? "—"}</Td>
            <Td>
              <div className="flex flex-wrap gap-1">
                {u.isActive ? <Badge tone="green">نشط</Badge> : <Badge tone="red">موقوف</Badge>}
                {u.expiresAt &&
                  (daysLeft(u.expiresAt) > 0 ? (
                    <Badge tone="amber">تجريبي · يتبقى {daysLeft(u.expiresAt)} يوم</Badge>
                  ) : (
                    <Badge tone="red">انتهت التجربة</Badge>
                  ))}
              </div>
            </Td>
            <Td>
              {canUpdate && u.id !== me.id && (
                <div className="flex flex-wrap gap-3">
                  <form action={setUserActive.bind(null, u.id, !u.isActive)}>
                    <button className="text-xs text-brand-700 hover:underline">{u.isActive ? "إيقاف" : "تفعيل"}</button>
                  </form>
                  {u.expiresAt ? (
                    <>
                      <form action={setUserTrial.bind(null, u.id, 15)}>
                        <button className="text-xs text-brand-700 hover:underline">تمديد 15 يوماً</button>
                      </form>
                      <form action={setUserTrial.bind(null, u.id, 0)}>
                        <button className="text-xs text-brand-700 hover:underline">جعله دائماً</button>
                      </form>
                    </>
                  ) : (
                    <form action={setUserTrial.bind(null, u.id, 15)}>
                      <button className="text-xs text-gray-500 hover:underline">تحويله لتجريبي 15 يوماً</button>
                    </form>
                  )}
                </div>
              )}
            </Td>
          </tr>
        ))}
      </Table>
        </>
      )}
    </>
  );
}
