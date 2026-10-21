import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listPeriods, yearClosePreview } from "@/lib/periods";
import { MONTHS_AR } from "@/data/payroll";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { accrualPreview, listAccruals } from "@/lib/accruals";
import { errorMessage } from "@/lib/errors";
import { addYear, closeYearAction, postAccrualAction, reopenYearAction, togglePeriod, undoAccrualAction } from "./actions";

const fmt = (v: number) => v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const previousMonth = (today: string) => {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

export default async function PeriodsPage({ searchParams }: { searchParams: Promise<{ accrual?: string }> }) {
  const user = await requirePermission("fiscal_periods", "view");
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.accrual ?? "") ? sp.accrual! : previousMonth(todayRiyadh());
  const accruals = await listAccruals(db);
  const posted = accruals.find((a) => a.month === month);
  let preview: Awaited<ReturnType<typeof accrualPreview>> | null = null;
  let previewError = "";
  if (!posted) {
    try {
      preview = await accrualPreview(db, month);
    } catch (err) {
      previewError = errorMessage(err);
    }
  }
  const years = await listPeriods(db);
  const canUpdate = can(user.perms, "fiscal_periods", "update");
  const canYear = can(user.perms, "fiscal_periods", "approve");
  const canCreate = can(user.perms, "fiscal_periods", "create");
  const nextYear = (years[0]?.year ?? Number(todayRiyadh().slice(0, 4)) - 1) + 1;
  const previews = new Map(await Promise.all(years.filter((y) => !y.closing).map(async (y) => [y.year, await yearClosePreview(db, y.year)] as const)));

  return (
    <>
      <PageHeader title="الفترات المحاسبية والإقفال" description="قفل الشهر يمنع ترحيل أي مستند بتاريخه أو إرجاعه لمسودة، فلا تتغير أرقام شهر قدمت إقراره. وإقفال السنة ينقل صافي الربح إلى الأرباح المبقاة.">
        {canCreate && (
          <ActionForm action={addYear.bind(null, nextYear)} resetOnSuccess={false}>
            <SubmitButton variant="secondary">فتح السنة {nextYear}</SubmitButton>
          </ActionForm>
        )}
      </PageHeader>

      <Card title="الإيراد المستحق غير المفوتر (1112)" className="mb-6">
        <p className="mb-4 text-sm text-gray-500">
          الرحلات المعتمدة حتى آخر الشهر التي لم تصدر فاتورتها بعد تُعترف كإيراد في شهرها: مدين 1112 لكل عميل ودائن الإيراد لكل مركبة، ويُعكس القيد تلقائياً أول الشهر التالي فلا يتكرر الإيراد عند الفوترة.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <form className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gray-600">الشهر</span>
              <input type="month" name="accrual" defaultValue={month} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
            </label>
            <button type="submit" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
              عرض
            </button>
          </form>
          {posted ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="green">مرحّل</Badge>
              <Link href={`/journal?open=${posted.id}`} className="ltr-nums text-sm text-brand-700 hover:underline">
                {posted.number}
              </Link>
              <span className="ltr-nums text-sm font-semibold text-gray-800">{fmt(posted.total)} SAR</span>
              {canYear && (
                <ActionForm action={undoAccrualAction.bind(null, month)} resetOnSuccess={false}>
                  <SubmitButton variant="secondary">إلغاء الاستحقاق</SubmitButton>
                </ActionForm>
              )}
            </div>
          ) : previewError ? (
            <p className="text-sm text-red-700">{previewError}</p>
          ) : preview && preview.count > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-600">
                <span className="ltr-nums font-semibold text-gray-900">{preview.count}</span> رحلة لـ {preview.customers.length} عميل بمبلغ{" "}
                <span className="ltr-nums font-semibold text-gray-900">{fmt(preview.total)}</span> ريال
              </span>
              {canYear && (
                <ActionForm action={postAccrualAction.bind(null, month)} resetOnSuccess={false}>
                  <SubmitButton>ترحيل الاستحقاق وعكسه</SubmitButton>
                </ActionForm>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">لا رحلات معتمدة غير مفوترة حتى آخر هذا الشهر.</p>
          )}
        </div>
        {preview && preview.customers.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {preview.customers.map((c) => (
              <span key={c.customer} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                {c.customer} · <span className="ltr-nums">{c.count}</span> · <span className="ltr-nums">{fmt(c.amount)}</span>
              </span>
            ))}
          </div>
        )}
        {accruals.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
            المرحّل:{" "}
            {accruals.map((a, i) => (
              <span key={a.id}>
                {i > 0 && " · "}
                <Link href={`/periods?accrual=${a.month}`} className="ltr-nums hover:text-brand-700">
                  {a.month} ({fmt(a.total)})
                </Link>
              </span>
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-6">
        {years.map((y) => {
          const preview = previews.get(y.year);
          const closedCount = y.months.filter((m) => m.status === "closed").length;
          return (
            <Card key={y.year}>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <h2 className="ltr-nums font-display text-lg font-semibold text-brand-900">{y.year}</h2>
                {y.closing ? <Badge tone="green">السنة مقفلة</Badge> : <Badge tone="gray">{closedCount} / 12 شهر مقفل</Badge>}
                <span className="ms-auto" />
                {y.closing ? (
                  <>
                    <Link href={`/journal?open=${y.closing.id}`} className="ltr-nums text-sm text-brand-700 hover:underline">
                      قيد الإقفال {y.closing.number}
                    </Link>
                    {canYear && (
                      <ActionForm action={reopenYearAction.bind(null, y.year)} resetOnSuccess={false}>
                        <SubmitButton variant="secondary">إلغاء إقفال السنة</SubmitButton>
                      </ActionForm>
                    )}
                  </>
                ) : (
                  canYear &&
                  preview &&
                  preview.lines > 0 && (
                    <ActionForm action={closeYearAction.bind(null, y.year)} resetOnSuccess={false} className="flex items-center gap-3">
                      <span className="text-sm text-gray-500">
                        صافي {preview.net >= 0 ? "الربح" : "الخسارة"}: <span className="ltr-nums font-semibold text-gray-800">{fmt(Math.abs(preview.net))}</span>
                      </span>
                      <SubmitButton>إقفال السنة</SubmitButton>
                    </ActionForm>
                  )
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {y.months.map((m) => {
                  const closed = m.status === "closed";
                  return (
                    <div key={m.id} className={`flex flex-col gap-2 rounded-xl border p-3 ${closed ? "border-gray-200 bg-gray-50" : "border-brand-500/30 bg-white"}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800">{MONTHS_AR[m.month - 1]}</span>
                        <span className="ms-auto">{closed ? <Badge tone="gray">مقفل</Badge> : <Badge tone="green">مفتوح</Badge>}</span>
                      </div>
                      <div className="ltr-nums text-xs text-gray-500">
                        {m.posted} قيد مرحّل{m.drafts > 0 && <span className="text-amber-700"> · {m.drafts} مسودة</span>}
                      </div>
                      {canUpdate && !y.closing && (
                        <ActionForm action={togglePeriod.bind(null, m.id, closed ? "open" : "closed")} resetOnSuccess={false}>
                          <SubmitButton variant="secondary" className="w-full py-1 text-xs">
                            {closed ? "فتح" : "قفل"}
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
