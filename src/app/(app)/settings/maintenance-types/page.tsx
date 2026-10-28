import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { maintenanceTypeOptions } from "@/lib/driver-app";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Input, PageHeader } from "@/components/ui";
import { saveMaintenanceTypeAction } from "./actions";

const check = "size-4 accent-brand-600";

export default async function MaintenanceTypesPage() {
  const user = await requirePermission("settings", "view");
  const edit = can(user.perms, "settings", "update");
  const types = await maintenanceTypeOptions(db, { all: true });

  return (
    <>
      <PageHeader
        title="أنواع الصيانة"
        description="القائمة التي يختار منها السائق نوع الصيانة في مصروفاته وطلبات الصيانة، وتُستخدم للفلترة. أوقف النوع بدل حذفه ليبقى في السجلات القديمة."
      >
        <Link href="/settings" className="text-sm text-brand-700 hover:underline">
          → الإعدادات
        </Link>
      </PageHeader>
      <Card>
        <div className="mb-2 hidden grid-cols-[1fr_1fr_5rem_5rem_6rem] gap-2 px-1 text-xs text-gray-500 sm:grid">
          <span>الاسم بالعربية</span>
          <span>الاسم بالإنجليزية (لتطبيق السائق بغير العربية)</span>
          <span>الترتيب</span>
          <span />
          <span />
        </div>
        <div className="space-y-2">
          {[...types, null].map((t) =>
            !t && !edit ? null : (
              <ActionForm key={t?.id ?? "new"} action={saveMaintenanceTypeAction} resetOnSuccess={!t} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_5rem_5rem_6rem]">
                <input type="hidden" name="id" value={t?.id ?? ""} />
                <Input name="nameAr" required defaultValue={t?.nameAr ?? ""} placeholder="نوع جديد" disabled={!edit} />
                <Input name="nameEn" defaultValue={t?.nameEn ?? ""} placeholder="English name" dir="ltr" disabled={!edit} />
                <Input type="number" name="sortOrder" defaultValue={t?.sortOrder ?? ""} placeholder="50" disabled={!edit} title="الترتيب في القائمة" />
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  <input type="checkbox" name="active" defaultChecked={t?.isActive ?? true} disabled={!edit} className={check} />
                  فعّال
                </label>
                {edit && <SubmitButton variant={t ? "secondary" : "primary"}>{t ? "حفظ" : "إضافة"}</SubmitButton>}
              </ActionForm>
            ),
          )}
        </div>
        <p className="mt-3 text-xs text-gray-500">اجعل «أخرى» آخر القائمة بترتيب كبير (مثل 99).</p>
      </Card>
    </>
  );
}
