import Link from "next/link";

/** رابط صغير لصفحة تعديل السجل وحذفه وسجل تعديلاته. */
export function EditLink({ href, label = "تعديل" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="ms-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-normal text-brand-700 hover:bg-brand-50 print:hidden" title={label}>
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      {label}
    </Link>
  );
}
