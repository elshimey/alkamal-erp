import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { ACTIONS, ALL_ACTIONS, ALL_ENTITIES, ENTITIES, MODULES, SPECIAL, SPECIAL_ENTITY, can, type Module } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { saveRolePermissions } from "../actions";

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("roles", "view");
  const roleId = Number((await params).id);
  if (!Number.isInteger(roleId)) notFound();
  const [role] = await db.select().from(s.roles).where(eq(s.roles.id, roleId));
  if (!role) notFound();
  const perms = await db.select().from(s.rolePermissions).where(eq(s.rolePermissions.roleId, roleId));

  const isAdmin = role.key === "admin";
  const editable = !role.isSystem && can(me.perms, "roles", "update");
  const has = (entity: string, action: string) => isAdmin || perms.some((p) => p.entity === entity && p.action === action);
  const scopeOf = (entity: string) => (perms.some((p) => p.entity === entity && p.scope === "own") ? "own" : "all");

  return (
    <>
      <PageHeader title={role.nameAr} description={role.description ?? undefined}>
        <Link href="/roles" className="text-sm text-brand-700 hover:underline">
          ← كل الأدوار
        </Link>
      </PageHeader>
      {role.isSystem && (
        <p className="mb-4 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
          {isAdmin ? "مدير النظام يملك كل الصلاحيات دائماً." : "دور أساسي ثابت. لتعديله أنشئ دوراً مخصصاً بنسخة منه."}
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
            !role.isSystem && <Badge>للعرض فقط</Badge>
          )}
        </fieldset>
      </ActionForm>
    </>
  );
}
