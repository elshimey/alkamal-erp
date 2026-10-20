import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

const TABS = [
  { key: "overview", href: "/hr", label: "لوحة الموارد البشرية" },
  { key: "custody", href: "/hr/custody", label: "العُهد" },
  { key: "actions", href: "/hr/discipline", label: "الإنذارات والجزاءات والحوافز" },
  { key: "leaves", href: "/hr/leaves", label: "الإجازات" },
  { key: "attendance", href: "/hr/attendance", label: "الحضور" },
  { key: "evaluations", href: "/hr/evaluations", label: "التقييم والترقية" },
  { key: "advances", href: "/hr/advances", label: "مقدم العمولة" },
] as const;

export function HrTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200 print:hidden">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-4 py-2.5 text-sm whitespace-nowrap transition ${t.key === active ? "border-brand-600 font-semibold text-brand-900" : "border-transparent text-gray-500 hover:text-brand-700"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Kpis({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode; strong?: boolean; href?: string }[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map((k, i) => {
        const body = (
          <>
            <div className={`text-xs ${k.strong ? "text-white/70" : "text-gray-500"}`}>{k.label}</div>
            <div className="ltr-nums mt-1 text-xl font-semibold">{k.value}</div>
            {k.hint && <div className={`mt-1 text-xs ${k.strong ? "text-brand-500" : "text-gray-400"}`}>{k.hint}</div>}
          </>
        );
        const cls = `stagger animate-rise block rounded-2xl p-4 shadow-sm ${k.strong ? "bg-asphalt-900 text-white" : "bg-white"}`;
        return k.href ? (
          <Link key={k.label} href={k.href} className={`${cls} transition hover:-translate-y-0.5 hover:shadow-md`} style={{ "--i": i } as React.CSSProperties}>
            {body}
          </Link>
        ) : (
          <div key={k.label} className={cls} style={{ "--i": i } as React.CSSProperties}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** نموذج إدخال قابل للطي فوق القائمة. */
export function EntryPanel({ icon, title, hint, children, open }: { icon: IconName; title: string; hint?: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group mb-5 rounded-2xl border border-black/[0.06] bg-white shadow-sm print:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500 text-brand-900">
          <Icon name={icon} className="size-4" />
        </span>
        <span className="font-semibold text-brand-900">{title}</span>
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
        <span className="ms-auto text-xs text-gray-500 group-open:hidden">فتح</span>
      </summary>
      <div className="border-t border-gray-100 px-5 py-4">{children}</div>
    </details>
  );
}

export const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const YES_NO = [
  { value: "yes", label: "نعم" },
  { value: "no", label: "لا" },
];
