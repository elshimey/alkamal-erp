import Link from "next/link";

// أزرار رأس القوائم على طريقة وافق: «تعديل جماعي» و«إضافة ▾» (إضافة جماعية في شيت، أو استيراد من Excel).

const btn = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 print:hidden";

export function ListActions({
  bulkHref,
  addHref,
  importHref,
  newHref,
  newLabel = "إضافة واحد",
  addLabel = "إضافة جماعية",
}: {
  /** صفحة التعديل الجماعي (تُخفى إن لم تكن للمستخدم صلاحية التعديل) */
  bulkHref?: string | false;
  addHref?: string | false;
  importHref?: string | false;
  newHref?: string | false;
  newLabel?: string;
  addLabel?: string;
}) {
  const items = [newHref && { href: newHref, label: newLabel }, addHref && { href: addHref, label: addLabel }, importHref && { href: importHref, label: "الاستيراد من Excel" }].filter(Boolean) as { href: string; label: string }[];
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {bulkHref && (
        <Link href={bulkHref} className={btn}>
          تعديل جماعي
        </Link>
      )}
      {items.length === 1 && (
        <Link href={items[0].href} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
          + {items[0].label}
        </Link>
      )}
      {items.length > 1 && (
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
            إضافة <span className="text-xs">▾</span>
          </summary>
          <div className="absolute end-0 z-30 mt-1 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg">
            {items.map((i) => (
              <Link key={i.href} href={i.href} className="block px-4 py-2 hover:bg-gray-50">
                {i.label}
              </Link>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** رأس وضع الإضافة الجماعية: الشيت يأخذ الصفحة كاملة مع زر العودة للقائمة. */
export function AddModeBar({ backHref, backLabel, title }: { backHref: string; backLabel: string; title: string }) {
  return (
    <nav className="mb-4 flex items-center gap-1.5 text-sm">
      <Link href={backHref} className="text-gray-500 hover:text-gray-800">
        {backLabel}
      </Link>
      <span className="text-gray-400">›</span>
      <span className="font-semibold text-gray-800">{title}</span>
      <Link href={backHref} className={`${btn} ms-auto`}>
        العودة للقائمة
      </Link>
    </nav>
  );
}

/** تبديل «جدول / ورقة» في قوائم المستندات؛ الورقة تعدّل المسودات بطريقة Excel. */
export function ViewToggle({ base, params, view }: { base: string; params: Record<string, string | undefined>; view: "table" | "sheet" }) {
  const href = (v: "table" | "sheet") => {
    const q = new URLSearchParams(Object.entries({ ...params, view: v === "sheet" ? "sheet" : undefined }).filter(([, x]) => x) as [string, string][]);
    return q.size ? `${base}?${q}` : base;
  };
  const tab = (v: "table" | "sheet", label: string) => (
    <Link href={href(v)} scroll={false} className={`rounded-md px-3 py-1 transition ${view === v ? "bg-white font-semibold text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
      {label}
    </Link>
  );
  return (
    <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm shadow-sm print:hidden">
      {tab("table", "جدول")}
      {tab("sheet", "ورقة")}
    </div>
  );
}
