import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { getBrand } from "@/lib/brand";
import { alertKindsFor, dailySummary, OWNER_KINDS, summaryText } from "@/lib/documents";
import { CopyButton } from "@/components/copy-button";
import { ExpiryBadge } from "@/components/expiry-badge";
import { Card, PageHeader } from "@/components/ui";

type Row = Awaited<ReturnType<typeof dailySummary>>["expired"][number];

export default async function DailySummaryPage() {
  const user = await requirePermission("fleet_documents", "view");
  const today = todayRiyadh();
  const [sum, brand] = await Promise.all([dailySummary(db, today, alertKindsFor(user.perms)), getBrand()]);
  const text = summaryText(sum, brand.name);

  const section = (title: string, rows: Row[], tone: string) => (
    <Card title={`${title} (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">لا يوجد</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => (
            <li key={r.doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <Link href={`/fleet-documents/owner/${r.ownerKind}-${r.ownerId}`} className={`font-medium hover:underline ${tone}`}>
                {r.owner}
                <span className="ms-2 text-xs font-normal text-gray-500">{OWNER_KINDS[r.ownerKind].label}</span>
              </Link>
              <span className="flex items-center gap-2">
                <span>{r.type.nameAr}</span>
                <ExpiryBadge expiryDate={r.doc.expiryDate} today={today} alertDays={r.type.alertDays} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return (
    <>
      <PageHeader title="الملخص اليومي للوثائق" description={`ما يحتاج انتباهك اليوم ${today}. أرسله لمن يتابع التجديد عبر واتساب بضغطة.`}>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-95"
          >
            إرسال عبر واتساب
          </a>
          <CopyButton text={text} label="نسخ النص" />
          <Link href="/fleet-documents" className="ps-2 text-sm text-brand-700 hover:underline">
            → سجل الوثائق
          </Link>
        </div>
      </PageHeader>

      {sum.critical.length > 0 && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          عاجل: {sum.critical.map((r) => `${r.type.nameAr} ${r.doc.expiryDate}`).join("، ")}
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <Link href="/fleet-documents/reports?r=missing" className="rounded-xl bg-white px-4 py-2 shadow-sm hover:bg-brand-50">
          وثائق إلزامية ناقصة: <b>{sum.missing}</b>
        </Link>
        <Link href="/fleet-documents/submissions" className={`rounded-xl px-4 py-2 shadow-sm ${sum.pending ? "bg-amber-50 text-amber-900" : "bg-white"} hover:bg-brand-50`}>
          رفعها السائقون بانتظار الاعتماد: <b>{sum.pending}</b>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {section("منتهية لم تُجدَّد", sum.expired, "text-red-700")}
        {section("تنتهي اليوم", sum.dueToday, "text-red-700")}
        {section("دخلت مرحلة تنبيه اليوم", sum.newStage, "text-amber-800")}
      </div>

      <details className="mt-6 rounded-2xl border border-black/[0.06] bg-white p-4 text-sm shadow-sm">
        <summary className="cursor-pointer select-none font-medium text-gray-700">نص الرسالة</summary>
        <pre className="mt-3 whitespace-pre-wrap font-sans text-gray-700">{text}</pre>
      </details>
    </>
  );
}
