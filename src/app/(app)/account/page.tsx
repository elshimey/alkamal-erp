import { requireUser } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { PasswordInput } from "@/components/password-input";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, PageHeader } from "@/components/ui";
import { changePassword } from "./actions";

export default async function AccountPage() {
  const me = await requireUser();
  return (
    <>
      <PageHeader title="حسابي" description={`${me.name} · ${me.roles.map((r) => r.nameAr).join("، ")}`} />
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
    </>
  );
}
