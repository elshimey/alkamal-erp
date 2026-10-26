import { requireUser } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { PasswordInput } from "@/components/password-input";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { changePassword, setMyEmail } from "./actions";

export default async function AccountPage() {
  const me = await requireUser();
  const [row] = await db.select({ email: s.users.email, login: s.users.login }).from(s.users).where(eq(s.users.id, me.id));
  return (
    <>
      <PageHeader title="حسابي" description={`${me.name} · ${me.roles.map((r) => r.nameAr).join("، ")}`} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card title="تغيير كلمة المرور" className="max-w-md">
        <ActionForm action={changePassword} className="flex flex-col gap-4">
          <Field label="كلمة المرور الحالية">
            <PasswordInput name="current" required dir="ltr" autoComplete="current-password" />
          </Field>
          <Field label="كلمة المرور الجديدة">
            <PasswordInput name="next" required minLength={MIN_PASSWORD_LENGTH} dir="ltr" autoComplete="new-password" />
          </Field>
          <Field label="تأكيد كلمة المرور الجديدة">
            <PasswordInput name="confirm" required dir="ltr" autoComplete="new-password" />
          </Field>
          <SubmitButton>حفظ</SubmitButton>
        </ActionForm>
      </Card>
      <Card title="بريد استرجاع كلمة المرور" className="max-w-md">
        <ActionForm action={setMyEmail} className="flex flex-col gap-4" resetOnSuccess={false}>
          <Field label="البريد الإلكتروني" hint="إن نسيت كلمة المرور يصلك عليه رابط لتعيين كلمة جديدة">
            <Input name="email" type="email" dir="ltr" defaultValue={row?.email ?? (row?.login.includes("@") ? row.login : "")} />
          </Field>
          <SubmitButton>حفظ</SubmitButton>
        </ActionForm>
      </Card>
      </div>
    </>
  );
}
