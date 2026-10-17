import Link from "next/link";

const TABS = [
  { key: "orders", href: "/maintenance", label: "أوامر الصيانة" },
  { key: "requests", href: "/maintenance/requests", label: "طلبات العطل" },
  { key: "plans", href: "/maintenance/plans", label: "الصيانة الدورية" },
] as const;

export function MaintenanceTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="mb-6 flex gap-1 border-b border-gray-200">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition ${t.key === active ? "border-brand-600 font-semibold text-brand-900" : "border-transparent text-gray-500 hover:text-brand-700"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
