import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { REPORT_GROUPS } from "@/data/reports";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";

/** مركز التقارير على تقسيم وافق: المالية، للمحاسب، المبيعات، المشتريات، الضرائب، المخزون، الرواتب. */
export default async function ReportsPage() {
  const user = await requirePermission("financial_reports", "view");
  return (
    <>
      <PageHeader title="التقارير" description="الأرقام المالية من القيود المرحّلة فقط وبالريال. كل تقرير يُصدَّر إلى Excel ويُطبع بالشعار والفترة وأرقام الصفحات." />
      <div className="flex flex-col gap-8">
        {REPORT_GROUPS.map((g) => {
          const reports = g.reports.filter((r) => !r.entity || can(user.perms, r.entity, "view"));
          if (!reports.length) return null;
          return (
            <section key={g.title}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-500">
                <span className="h-4 w-1 rounded-full bg-brand-600" />
                {g.title}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {reports.map((r) => (
                  <Link key={r.href} href={r.href} className="group flex gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-brand-600/50 hover:shadow-md">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-asphalt-900 text-brand-500 transition group-hover:scale-105">
                      <Icon name={r.icon} className="size-4.5" />
                    </span>
                    <span>
                      <span className="block font-semibold text-brand-900">{r.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{r.description}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
