import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import * as s from "@/db/schema";
import { vehicleOptions } from "@/lib/lookups";
import { joinCustom } from "@/data/custom-lists";
import { customListOptions } from "@/lib/custom-lists";
import { FormCombo } from "@/components/form-combo";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { Input } from "@/components/ui";
import { savePlanAction } from "./actions";

/** نافذة خطة صيانة دورية: إضافة أو تعديل خطة بعينها (مع إيقافها). */
export async function PlanPanel({ id, closeHref, savedHref }: { id: number | null; closeHref: string; savedHref: string }) {
  const [vehicles, kinds, plan] = await Promise.all([vehicleOptions(), customListOptions(db, "maintenance_kind"), id ? db.select().from(s.maintenancePlans).where(eq(s.maintenancePlans.id, id)).then((r) => r[0]) : Promise.resolve(undefined)]);
  if (id && !plan) notFound();
  return (
    <RecordPanel
      title={plan ? `تعديل الخطة: ${plan.title}` : "خطة صيانة دورية جديدة"}
      subtitle="تظهر في التنبيهات قبل موعدها، وإكمال أمر مرتبط بها يحدّث آخر تنفيذ"
      closeHref={closeHref}
      savedHref={savedHref}
      action={savePlanAction.bind(null, id)}
      creating={!plan}
    >
      <PanelSection title="الخطة">
        <PanelField label="المركبة" required>
          <FormCombo name="vehicleId" options={vehicles} create="vehicle" defaultValue={plan ? String(plan.vehicleId) : ""} required placeholder="اكتب اللوحة…" />
        </PanelField>
        <PanelField label="اسم الصيانة" required hint="تغيير زيت، فحص فرامل…">
          <Input name="title" required defaultValue={plan?.title} className="w-full" />
        </PanelField>
        <PanelField label="نوع الصيانة" required hint="أو أضف نوعاً جديداً من القائمة">
          <FormCombo name="type" options={kinds} create="maintenance_kind" defaultValue={plan ? joinCustom(plan.type, plan.typeClassId) : "mechanical"} required placeholder="اختر أو أضف نوعاً…" />
        </PanelField>
        <PanelField label="تتكرر كل (يوم)" required>
          <Input name="intervalDays" type="number" min={1} max={3650} step={1} required defaultValue={plan?.intervalDays} dir="ltr" className="w-full" />
        </PanelField>
        <PanelField label="آخر تنفيذ" hint="فارغ = مستحقة الآن">
          <Input name="lastDone" type="date" defaultValue={plan?.lastDoneDate ?? ""} className="w-full" />
        </PanelField>
        {plan && (
          <PanelField label="الحالة">
            <span className="flex items-center gap-2">
              <input type="checkbox" name="isActive" defaultChecked={plan.isActive} className="size-4 accent-brand-600" />
              نشطة (إلغاء التحديد يوقف الخطة وتنبيهاتها)
            </span>
          </PanelField>
        )}
      </PanelSection>
      {!plan && <p className="text-xs text-gray-500">إن كان للمركبة خطة بنفس الاسم تُحدَّث بدل إضافة خطة ثانية.</p>}
    </RecordPanel>
  );
}
