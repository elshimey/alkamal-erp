import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Icon } from "@/components/icons";
import { Card, PageHeader } from "@/components/ui";

export default async function ExportPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="تصدير كل البيانات" description="نسخة كاملة من بيانات شركتك في ملف Excel واحد، تحتفظ بها أو تسلّمها لمراجع الحسابات.">
        <Link href="/settings" className="text-sm font-medium text-brand-700 hover:underline">
          ← الإعدادات
        </Link>
      </PageHeader>
      <Card className="max-w-3xl">
        <ul className="mb-5 list-disc space-y-1.5 ps-5 text-sm text-gray-700">
          <li>ورقة لكل قسم: شجرة الحسابات، العملاء والموردون، المركبات، السائقون، الشحنات، الفواتير، السندات، القيود وسطورها، المصروفات، الرواتب، الصيانة، المخزون، الأصول وغيرها.</li>
          <li>أسماء الأعمدة بالعربية، ويظهر اسم العميل والحساب والمركبة بدل أرقامها الداخلية.</li>
          <li>ورقة «الفهرس» في أول الملف بعدد صفوف كل ورقة ورابط إليها.</li>
          <li>لا يشمل كلمات المرور ولا الصور.</li>
        </ul>
        <a
          href="/settings/export/download"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500"
        >
          <Icon name="download" />
          تنزيل ملف Excel
        </a>
        <p className="mt-3 text-xs text-gray-500">قد يستغرق التجهيز بضع ثوانٍ حسب حجم البيانات.</p>
      </Card>
    </>
  );
}
