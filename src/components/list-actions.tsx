import Link from "next/link";
import { AddMenu } from "./add-menu";

// أزرار رأس القوائم على طريقة وافق: «تعديل جماعي»، و«+ إضافة» لسجل واحد مع سهم منفصل للإضافة الجماعية والاستيراد.

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
  const more = [addHref && { href: addHref, label: addLabel }, importHref && { href: importHref, label: "الاستيراد من Excel" }].filter(Boolean) as { href: string; label: string }[];
  const main = newHref ? { href: newHref, label: newLabel } : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {bulkHref && (
        <Link href={bulkHref} className={btn}>
          تعديل جماعي
        </Link>
      )}
      {main || more.length > 1 ? <AddMenu main={main} more={more} /> : more.length === 1 && <AddMenu main={more[0]} more={[]} />}
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
