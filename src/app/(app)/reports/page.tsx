import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/ui";

const REPORTS: { href: string; title: string; description: string; icon: IconName }[] = [
  { href: "/reports/trial-balance", title: "ميزان المراجعة", description: "الرصيد الافتتاحي والحركة والرصيد الختامي لكل حساب، بمستوى التفصيل الذي تختاره.", icon: "ledger" },
  { href: "/reports/income", title: "قائمة الدخل", description: "الإيرادات والتكاليف وصافي الربح بتبويب الوظيفة، مع المقارنة بالفترة السابقة.", icon: "chart" },
  { href: "/reports/balance-sheet", title: "قائمة المركز المالي", description: "الأصول والالتزامات وحقوق الملكية في أي تاريخ، مع ربح السنة الجارية.", icon: "tree" },
  { href: "/reports/ledger", title: "كشف حساب", description: "حركة أي حساب أو مجموعة حسابات برصيد متحرك، ويمكن تصفيته بمركز تكلفة.", icon: "document" },
  { href: "/reports/cost-centers", title: "ربحية مراكز التكلفة", description: "إيراد وتكلفة وربح كل مركبة ومركز تكلفة، وهامش الربح.", icon: "truck" },
  { href: "/reports/vat", title: "إقرار ضريبة القيمة المضافة", description: "المبيعات الخاضعة والصفرية، وضريبة المخرجات والمدخلات، وصافي المستحق للهيئة.", icon: "invoice" },
];

export default async function ReportsPage() {
  await requirePermission("financial_reports", "view");
  return (
    <>
      <PageHeader title="التقارير المالية" description="كل الأرقام من القيود المرحّلة فقط وبالريال. كل تقرير يُصدَّر إلى Excel ويُطبع." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="group rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-brand-600/50 hover:shadow-md"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-asphalt-900 text-brand-500 transition group-hover:scale-105">
              <Icon name={r.icon} className="size-5" />
            </span>
            <h2 className="mt-4 font-semibold text-brand-900">{r.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">{r.description}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
