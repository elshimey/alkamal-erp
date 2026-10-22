import Link from "next/link";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { setupSteps } from "@/lib/setup";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";

export default async function SetupPage() {
  const user = await requireUser();
  const steps = (await setupSteps(db)).filter((s) => !s.entity || can(user.perms, s.entity, "view"));
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 100;

  return (
    <>
      <PageHeader title="إعداد الشركة" description="خطوات تجهيز النظام للعمل. كل خطوة تكتمل وحدها عند إدخال بياناتها، ويمكنك العودة لهذه الصفحة في أي وقت." />

      <div className="mb-6 max-w-3xl rounded-2xl bg-asphalt-900 p-5 text-white shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-lg font-semibold">{done === steps.length ? "اكتمل الإعداد، النظام جاهز للعمل" : `أنجزت ${done} من ${steps.length} خطوات`}</span>
          <span className="ltr-nums text-2xl font-bold text-brand-500">{pct}%</span>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {next && (
          <p className="mt-3 text-sm text-white/75">
            الخطوة التالية: <b className="text-white">{next.title}</b>
          </p>
        )}
      </div>

      <ol className="flex max-w-3xl flex-col gap-3">
        {steps.map((s, i) => {
          const current = s.key === next?.key;
          return (
            <li
              key={s.key}
              className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center ${current ? "border-brand-500 ring-2 ring-brand-500/30" : "border-gray-200"}`}
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.done ? "bg-green-600 text-white" : current ? "bg-brand-600 text-brand-900" : "bg-gray-100 text-gray-500"}`}
              >
                {s.done ? <Icon name="check" className="size-5" /> : <span className="ltr-nums">{i + 1}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900">{s.title}</div>
                <p className="text-sm text-gray-500">{s.description}</p>
                <p className={`mt-1 text-xs font-medium ${s.done ? "text-green-700" : "text-amber-700"}`}>{s.detail}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {s.importHref && !s.done && (
                  <Link href={s.importHref} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    استيراد من Excel
                  </Link>
                )}
                <Link
                  href={s.href}
                  className={`rounded-lg px-3 py-2 text-sm font-medium shadow-sm ${s.done ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50" : "bg-brand-600 font-semibold text-brand-900 hover:bg-brand-500"}`}
                >
                  {s.done ? "مراجعة" : s.action}
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
