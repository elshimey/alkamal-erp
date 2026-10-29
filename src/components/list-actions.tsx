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
