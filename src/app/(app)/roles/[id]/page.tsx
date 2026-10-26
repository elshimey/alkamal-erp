import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { ACTIONS, ALL_ACTIONS, ALL_ENTITIES, ENTITIES, MODULES, SPECIAL, SPECIAL_ENTITY, can, type Module } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader } from "@/components/ui";
import { DialogButton } from "@/components/dialog-button";
import { deleteRole, renameRole, restoreRoleDefaults, saveRolePermissions } from "../actions";

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("roles", "view");
  const roleId = Number((await params).id);
  if (!Number.isInteger(roleId)) notFound();
  const [role] = await db.select().from(s.roles).where(eq(s.roles.id, roleId));
  if (!role) notFound();
  const perms = await db.select().from(s.rolePermissions).where(eq(s.rolePermissions.roleId, roleId));
  const users = await db.select({ id: s.userRoles.userId }).from(s.userRoles).where(eq(s.userRoles.roleId, roleId));

  const isAdmin = role.key === "admin";
  const editable = !isAdmin && can(me.perms, "roles", "update");
  const has = (entity: string, action: string) => isAdmin || perms.some((p) => p.entity === entity && p.action === action);
  const scopeOf = (entity: string) => (perms.some((p) => p.entity === entity && p.scope === "own") ? "own" : "all");

  return (
    <>
      <PageHeader title={role.nameAr} description={role.description ?? undefined}>
        <div className="flex flex-wrap items-center gap-2">
          {editable && role.isSystem && (
            <DialogButton label="استعادة الصلاحيات الافتراضية" title={`استعادة صلاحيات «${role.nameAr}»`}>
              <p className="mb-3 text-sm leading-relaxed text-gray-600">تعود صلاحيات هذا الدور كما جاءت مع البرنامج، وتُلغى تعديلاتك عليه.</p>
              <ActionForm action={restoreRoleDefaults.bind(null, roleId)} resetOnSuccess={false}>
                <SubmitButton>تأكيد الاستعادة</SubmitButton>
              </ActionForm>
            </DialogButton>
          )}
          {editable && !role.isSystem && (
            <DialogButton label="تعديل الاسم" title="اسم الدور ووصفه">
              <ActionForm action={renameRole.bind(null, roleId)} resetOnSuccess={false} className="flex flex-col gap-3">
                <Field label="اسم الدور">
                  <Input name="nameAr" required defaultValue={role.nameAr} />
                </Field>
                <Field label="الوصف">
                  <Input name="description" defaultValue={role.description ?? ""} />
                </Field>
                <div>
                  <SubmitButton>حفظ</SubmitButton>
                </div>
              </ActionForm>
            </DialogButton>
          )}
          {!role.isSystem && can(me.perms, "roles", "delete") && (
            <DialogButton label="حذف الدور" title={`حذف «${role.nameAr}»`} danger>
              {users.length ? (
                <p className="text-sm leading-relaxed text-gray-600">الدور مسند إلى {users.length} مستخدم. غيّر دورهم من صفحة المستخدمين أولاً ثم احذفه.</p>
              ) : (
                <>
                  <p className="mb-3 text-sm leading-relaxed text-gray-600">يُحذف الدور وصلاحياته نهائياً.</p>
                  <ActionForm action={deleteRole.bind(null, roleId)} resetOnSuccess={false}>
                    <SubmitButton className="!bg-red-600 !text-white hover:!bg-red-500">تأكيد الحذف</SubmitButton>
                  </ActionForm>
                </>
              )}
            </DialogButton>
          )}
          <Link href="/roles" className="text-sm text-brand-700 hover:underline">
            ← كل الأدوار
          </Link>
        </div>
      </PageHeader>
      {role.isSystem && (
        <p className="mb-4 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
          {isAdmin
            ? "مدير النظام يملك كل الصلاحيات دائماً، ولا تحتاج مصفوفته إلى تعديل."
            : "دور أساسي: عدّل صلاحياته كما تناسب شركتك ثم اضغط «حفظ الصلاحيات»، ويمكنك إرجاعها في أي وقت بزر «استعادة الصلاحيات الافتراضية»."}
        </p>
      )}
      <ActionForm action={saveRolePermissions.bind(null, roleId)} resetOnSuccess={false}>
        <fieldset disabled={!editable} className="flex flex-col gap-6">
          {(Object.keys(MODULES) as Module[]).map((mod) => (
            <Card key={mod} title={MODULES[mod]}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500">
                      <th className="w-52 py-2 text-start font-medium">الكيان</th>
                      {ALL_ACTIONS.map((a) => (
                        <th key={a} className="px-2 py-2 font-medium whitespace-nowrap">
                          {ACTIONS[a]}
                        </th>
                      ))}
                      <th className="px-2 py-2 font-medium">النطاق</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {ALL_ENTITIES.filter((e) => ENTITIES[e].module === mod).map((e) => (
                      <tr key={e}>
                        <td className="py-2 whitespace-nowrap">{ENTITIES[e].label}</td>
                        {ALL_ACTIONS.map((a) => (
                          <td key={a} className="px-2 py-2 text-center">
                            <input type="checkbox" name="p" value={`${e}:${a}`} defaultChecked={has(e, a)} className="size-4" aria-label={`${ENTITIES[e].label} — ${ACTIONS[a]}`} />
                          </td>
                        ))}
                        <td className="px-2 py-2">
                          <select name={`scope:${e}`} defaultValue={scopeOf(e)} className="rounded border border-gray-300 px-1 py-0.5 text-xs">
                            <option value="all">الكل</option>
                            <option value="own">سجلاته فقط</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          <Card title="صلاحيات خاصة">
            <div className="flex flex-col gap-2">
              {Object.entries(SPECIAL).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="p" value={`${SPECIAL_ENTITY}:${key}`} defaultChecked={has(SPECIAL_ENTITY, key)} className="size-4" />
                  {label}
                </label>
              ))}
            </div>
          </Card>
          {editable ? (
            <div>
              <SubmitButton>حفظ الصلاحيات</SubmitButton>
            </div>
          ) : (
            !isAdmin && <Badge>للعرض فقط</Badge>
          )}
        </fieldset>
      </ActionForm>
    </>
  );
}
