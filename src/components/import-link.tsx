import Link from "next/link";
import { Icon } from "@/components/icons";

/** زر الاستيراد من Excel في رأس القوائم. */
export function ImportLink({ entity, label = "استيراد من Excel" }: { entity: string; label?: string }) {
  return (
    <Link
      href={`/import/${entity}`}
      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-brand-500/60 hover:bg-brand-50 print:hidden"
    >
      <Icon name="upload" className="size-4" />
      {label}
    </Link>
  );
}
