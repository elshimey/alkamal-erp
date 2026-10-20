import Link from "next/link";
import { Icon } from "@/components/icons";

export const BULK_LIMIT = 300;

/** زر تصدير المستندات الظاهرة في القائمة كملفات PDF داخل ملف مضغوط، أو طباعتها معاً. */
export function BulkPdfButton({ kind, ids, label = "تصدير PDF (ملف مضغوط)" }: { kind: string; ids: number[]; label?: string }) {
  if (!ids.length) return null;
  const list = ids.slice(0, BULK_LIMIT).join(",");
  return (
    <Link
      href={`/print/${kind}?ids=${list}&zip=1`}
      target="_blank"
      title={ids.length > BULK_LIMIT ? `أول ${BULK_LIMIT} مستند فقط؛ ضيّق الفلتر لتصدير الباقي` : "يصدّر المستندات الظاهرة حسب الفلتر الحالي"}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm hover:bg-gray-50"
    >
      <Icon name="download" className="size-4" />
      {label} <span className="ltr-nums text-gray-400">({Math.min(ids.length, BULK_LIMIT)})</span>
    </Link>
  );
}
