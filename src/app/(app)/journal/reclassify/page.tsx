import { requirePermission } from "@/lib/auth";
import { journalOptions } from "@/lib/journal-options";
import { todayRiyadh } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { ReclassifyForm } from "./form";

export default async function ReclassifyPage() {
  await requirePermission("journal_entries", "approve");
  const { accounts, centers } = await journalOptions();
  return (
    <>
      <PageHeader
        title="إعادة التصنيف المجمّع"
        description="انقل سطوراً مرحّلة من حساب أو مركز تكلفة إلى آخر دفعة واحدة. لا يُعدّل القيد الأصلي؛ يُنشأ قيد تصحيح مرحّل يعكس كل سطر ويقيده على الحساب الجديد."
      />
      <ReclassifyForm accounts={accounts} centers={centers} today={todayRiyadh()} />
    </>
  );
}
