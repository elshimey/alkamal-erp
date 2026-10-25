import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { RecordHistory } from "@/components/record-history";
import { Badge, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { createDriverLoginAction, deleteDriverAction, removeDriverLoginAction, resetDriverPasswordAction, updateDriverAction } from "../actions";

const LANG = { ar: "عربي", ur: "أوردو", hi: "هندي", en: "إنجليزي" } as const;
const STATUS = {
  active: { label: "نشط", tone: "green" },
  on_leave: { label: "إجازة", tone: "amber" },
  terminated: { label: "منتهية خدمته", tone: "red" },
} as const;

export default async function DriverPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("drivers", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const custody = alias(s.accounts, "custody");
  const [row] = await db
    .select({ d: s.drivers, e: s.employees, custodyCode: custody.code, login: s.users.login, loginActive: s.users.isActive, plate: s.vehicles.plate })
    .from(s.drivers)
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .innerJoin(custody, eq(custody.id, s.drivers.custodyAccountId))
    .leftJoin(s.users, eq(s.users.id, s.drivers.userId))
    .leftJoin(s.vehicleAssignments, and(eq(s.vehicleAssignments.driverId, s.drivers.id), isNull(s.vehicleAssignments.toDate)))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.vehicleAssignments.vehicleId))
    .where(eq(s.drivers.id, id));
  if (!row) notFound();
  const { d, e, custodyCode, login, loginActive, plate } = row;
  const canEdit = can(user.perms, "drivers", "update");
  const canDelete = can(user.perms, "drivers", "delete");
  const canLogin = can(user.perms, "users", "update");

  return (
    <>
      <PageHeader title={e.nameAr} description={`حساب العهدة ${custodyCode} · ${plate ? `المركبة الحالية ${plate}` : "بلا مركبة"}`}>
        <div className="flex items-center gap-3">
          <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
          <Link href={`/fleet-documents/owner/driver-${d.id}`} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50">
            الوثائق
          </Link>
          <Link href="/drivers" className="text-sm font-medium text-brand-700 hover:underline">
            ← كل السائقين
          </Link>
        </div>
      </PageHeader>

      <Card title="بيانات السائق" className="mb-6">
        <ActionForm action={updateDriverAction.bind(null, id)} resetOnSuccess={false} className="grid gap-4 sm:grid-cols-3">
          <fieldset disabled={!canEdit} className="contents">
            <Field label="الاسم">
              <Input name="nameAr" required defaultValue={e.nameAr} />
            </Field>
            <Field label="الجوال">
              <Input name="mobile" dir="ltr" defaultValue={d.mobile ?? ""} />
            </Field>
            <Field label="الجنسية">
              <Input name="nationality" defaultValue={d.nationality ?? ""} />
            </Field>
            <Field label="الهوية">
              <Input name="nationalId" dir="ltr" defaultValue={e.nationalId ?? ""} />
            </Field>
            <Field label="الإقامة">
              <Input name="residencyNumber" dir="ltr" defaultValue={d.residencyNumber ?? ""} />
            </Field>
            <Field label="الرخصة">
              <Input name="licenseNumber" dir="ltr" defaultValue={d.licenseNumber ?? ""} />
            </Field>
            <Field label="بطاقة هيئة النقل">
              <Input name="transportCardNumber" dir="ltr" defaultValue={d.transportCardNumber ?? ""} />
            </Field>
            <Field label="تاريخ الميلاد">
              <Input name="birthDate" type="date" defaultValue={d.birthDate ?? ""} />
            </Field>
            <Field label="تاريخ التعيين">
              <Input name="hireDate" type="date" defaultValue={e.hireDate ?? ""} />
            </Field>
            <Field label="لغة التطبيق">
              <Select name="appLanguage" defaultValue={d.appLanguage}>
                {Object.entries(LANG).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="فئة العمولة">
              <Select name="commissionClass" defaultValue={d.commissionClass}>
                <option value="domestic">داخلي</option>
                <option value="international">خارجي</option>
              </Select>
            </Field>
            <Field label="الحالة" hint="منتهي الخدمة يتوقف دخوله للتطبيق">
              <Select name="status" defaultValue={d.status}>
                {Object.entries(STATUS).map(([v, x]) => (
                  <option key={v} value={v}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الراتب الأساسي">
              <Input name="basicSalary" inputMode="decimal" dir="ltr" defaultValue={e.basicSalary} />
            </Field>
            <Field label="سقف العهدة" hint="فارغ = بلا سقف">
              <Input name="custodyLimit" inputMode="decimal" dir="ltr" defaultValue={d.custodyLimit ?? ""} />
            </Field>
          </fieldset>
          {canEdit && (
            <div className="col-span-full">
              <SubmitButton>حفظ التعديلات</SubmitButton>
            </div>
          )}
        </ActionForm>
      </Card>

      {canLogin && (
        <Card title="حساب دخول تطبيق السائق" className="mb-6">
          {login ? (
            <div className="space-y-5">
              <p className="text-sm text-gray-600">
                اسم الدخول: <bdi className="ltr-nums font-semibold text-gray-900">{login}</bdi>
                {!loginActive && <Badge tone="red">موقوف</Badge>}
                <span className="ms-2 text-gray-500">· يدخل من الرابط في الإعدادات ← تطبيق السائق</span>
              </p>
              <ActionForm action={resetDriverPasswordAction.bind(null, id)} className="grid items-end gap-4 sm:grid-cols-3">
                <Field label="كلمة مرور جديدة" hint={`${MIN_PASSWORD_LENGTH} أحرف على الأقل`}>
                  <Input name="password" type="text" required minLength={MIN_PASSWORD_LENGTH} dir="ltr" autoComplete="off" />
                </Field>
                <SubmitButton variant="secondary">تغيير كلمة المرور</SubmitButton>
              </ActionForm>
              <ActionForm action={removeDriverLoginAction.bind(null, id)} resetOnSuccess={false}>
                <SubmitButton variant="secondary" className="text-red-700">
                  حذف حساب الدخول
                </SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <ActionForm action={createDriverLoginAction} className="grid items-end gap-4 sm:grid-cols-3">
              <input type="hidden" name="driverId" value={id} />
              <Field label="اسم الدخول" hint="الجوال مثلاً">
                <Input name="login" required dir="ltr" defaultValue={d.mobile ?? ""} />
              </Field>
              <Field label="كلمة المرور" hint={`${MIN_PASSWORD_LENGTH} أحرف على الأقل`}>
                <Input name="password" type="text" required minLength={MIN_PASSWORD_LENGTH} dir="ltr" autoComplete="off" />
              </Field>
              <SubmitButton>إنشاء الحساب</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}

      <RecordHistory entity="drivers" id={id} also={[["employees", e.id]]} />

      {canDelete && (
        <Card title="حذف السائق">
          <p className="mb-4 text-sm text-gray-600">
            يُحذف السائق نهائياً مع حسابَي عهدته ورواتبه، ويُسمح بذلك فقط إن لم تكن له أي حركة. من له شحنات أو رواتب غيّر حالته إلى «منتهية خدمته» بدلاً من الحذف.
          </p>
          <ActionForm action={deleteDriverAction.bind(null, id)} className="grid items-end gap-4 sm:grid-cols-3">
            <Field label="اكتب «حذف» للتأكيد">
              <Input name="confirm" required autoComplete="off" />
            </Field>
            <SubmitButton variant="secondary" className="text-red-700">
              حذف السائق نهائياً
            </SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
