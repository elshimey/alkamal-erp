import { redirect } from "next/navigation";
import { getTenant, requireAdmin } from "@/lib/auth";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Input, PageHeader } from "@/components/ui";
import { resetAction } from "./actions";

export const maxDuration = 60;

export default async function SubscriptionPage() {
  await requireAdmin();
  const t = await getTenant();
  if (t.isHome || !t.tenant) redirect("/settings");
  const { tenant, daysLeft } = t;

  return (
    <>
      <PageHeader title="الاشتراك والبيانات" description={tenant.name} />
      <div className="grid max-w-3xl gap-6">
        <Card title="حالة الاشتراك">
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
            {tenant.status === "trial" ? (
              <>
                <Badge tone="amber">نسخة تجريبية</Badge>
                <span>
                  باقي <b className="ltr-nums">{Math.max(daysLeft ?? 0, 0)}</b> يوم، تنتهي في <span className="ltr-nums">{new Date(tenant.trial_ends_at!).toLocaleDateString("en-GB")}</span>. للاشتراك تواصل مع مزود البرنامج، وتبقى كل بياناتك كما هي.
                </span>
              </>
            ) : (
              <>
                <Badge tone="green">اشتراك فعلي</Badge>
                <span>الاشتراك مفعّل.</span>
              </>
            )}
          </div>
        </Card>

        <Card title="البدء من جديد">
          <p className="mb-3 text-sm leading-relaxed text-gray-600">
            يمسح كل ما سُجّل أثناء التجربة: الفواتير والقيود والشحنات والمركبات والسائقين والعملاء والموردين والمخزون والرواتب، ويعيد شجرة الحسابات والفترات كأنها جديدة. يبقى المستخدمون (عدا حسابات السائقين) وبيانات المنشأة وقالب الفاتورة. لا يمكن التراجع.
          </p>
          <p className="mb-3 text-sm text-gray-600">
            للتأكيد اكتب رمز الشركة <b dir="ltr">{tenant.slug}</b>
          </p>
          <ActionForm action={resetAction} resetOnSuccess={false} className="flex max-w-md gap-2">
            <Input name="confirm" required dir="ltr" autoComplete="off" />
            <SubmitButton className="!bg-red-600 !text-white" pendingLabel="جارٍ المسح…">
              امسح البيانات وابدأ من جديد
            </SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
