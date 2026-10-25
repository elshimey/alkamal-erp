import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { BLOCKING, listDocumentTypes, OWNER_KINDS, type OwnerKind } from "@/lib/documents";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Input, PageHeader, Select } from "@/components/ui";
import { saveDocumentTypeAction } from "../../fleet-documents/actions";

const check = "size-4 accent-brand-600";
const KINDS = Object.keys(OWNER_KINDS) as OwnerKind[];

export default async function DocumentTypesPage() {
  const user = await requirePermission("settings", "view");
  const edit = can(user.perms, "settings", "update");
  const types = await listDocumentTypes(db);

  return (
    <>
      <PageHeader title="أنواع الوثائق" description="لكل نوع: صاحبه، وهل هو إلزامي (يظهر «ناقص» إن لم يُسجَّل)، وأثر انتهائه، وأيام التنبيه قبل الانتهاء.">
        <Link href="/settings" className="text-sm text-brand-700 hover:underline">
          → الإعدادات
        </Link>
      </PageHeader>
      <div className="grid gap-6">
        {KINDS.map((kind) => {
          const list = types.filter((t) => t.ownerKind === kind);
          return (
            <Card key={kind} title={OWNER_KINDS[kind].plural}>
              <div className="space-y-2">
                {[...list, null].map((t) =>
                  !t && !edit ? null : (
                    <ActionForm key={t?.id ?? "new"} action={saveDocumentTypeAction} resetOnSuccess={!t} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={t?.id ?? ""} />
                      <input type="hidden" name="ownerKind" value={kind} />
                      <Input name="nameAr" required defaultValue={t?.nameAr ?? ""} placeholder="نوع جديد" disabled={!edit} className="min-w-44 flex-1" />
                      <Select name="blocking" defaultValue={t?.blocking ?? "alert"} disabled={!edit} className="w-40" title="أثر الانتهاء">
                        {Object.entries(BLOCKING).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </Select>
                      <Input name="alertDays" required defaultValue={t?.alertDays ?? "60,30,7"} disabled={!edit} dir="ltr" className="w-28" title="أيام التنبيه قبل الانتهاء" />
                      <Input name="authority" defaultValue={t?.authority ?? ""} placeholder="جهة الإصدار" disabled={!edit} className="w-40" />
                      <label className="flex items-center gap-1 text-xs text-gray-600">
                        <input type="checkbox" name="required" defaultChecked={t?.required ?? true} disabled={!edit} className={check} />
                        إلزامية
                      </label>
                      <label className="flex items-center gap-1 text-xs text-gray-600">
                        <input type="checkbox" name="isActive" defaultChecked={t?.isActive ?? true} disabled={!edit} className={check} />
                        فعّال
                      </label>
                      {edit && <SubmitButton variant={t ? "secondary" : "primary"}>{t ? "حفظ" : "إضافة"}</SubmitButton>}
                    </ActionForm>
                  ),
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-gray-500">
        أيام التنبيه تُكتب مفصولة بفاصلة، مثل 60,30,7: يبدأ التنبيه عند أكبرها. «تمنع» و«تمنع الدولي فقط» تُستخدم في المرحلة القادمة لمنع الإسناد والشحنة عند انتهاء الوثيقة.
        الاختيارية لا تظهر «ناقصة» إن لم تُسجَّل (مثل عقد الإيجار للمركبات المملوكة).
      </p>
    </>
  );
}
