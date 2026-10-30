import Link from "next/link";

const TABS = [
  { key: "orders", href: "/maintenance", label: "أوامر الصيانة" },
  { key: "requests", href: "/maintenance/requests", label: "طلبات العطل" },
  { key: "driver", href: "/maintenance/driver-requests", label: "طلبات السائقين" },
  { key: "plans", href: "/maintenance/plans", label: "الصيانة الدورية" },
] as const;

export function MaintenanceTabs({ active, badges = {} }: { active: (typeof TABS)[number]["key"]; badges?: Partial<Record<(typeof TABS)[number]["key"], number>> }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition ${t.key === active ? "border-brand-600 font-semibold text-brand-900" : "border-transparent text-gray-500 hover:text-brand-700"}`}
        >
          {t.label}
          {!!badges[t.key] && <span className="ms-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">{badges[t.key]}</span>}
        </Link>
      ))}
    </nav>
  );
}
