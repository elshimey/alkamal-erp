import Link from "next/link";

// سندات الصرف وما تحت المراجعة صفحة واحدة بتبويبين في القائمة (قرار أحمد 2026-11-22)
const TABS = [
  { key: "payments", href: "/payments", label: "سندات الصرف" },
  { key: "review", href: "/payments/review", label: "تحت المراجعة" },
] as const;

export function PaymentsTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200 print:hidden">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`-mb-px border-b-2 px-4 py-2.5 text-sm whitespace-nowrap transition ${t.key === active ? "border-brand-600 font-semibold text-brand-900" : "border-transparent text-gray-500 hover:text-brand-700"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
