import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { alertStage, currentDocuments, missingDocuments, OWNER_KINDS, renewalCosts, type OwnerKind } from "@/lib/documents";
import { DateInput } from "@/components/date-input";
import { ExportButton } from "@/components/export-button";
import { ExpiryBadge } from "@/components/expiry-badge";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { C, RTable } from "../../reports/report-ui";

const REPORTS = {
  expiring: "تنتهي خلال فترة",
  expired: "منتهية",
  missing: "ناقصة",
  cost: "تكلفة الإصدار والتجديد",
} as const;
type Report = keyof typeof REPORTS;
const KINDS = Object.keys(OWNER_KINDS) as OwnerKind[];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function DocumentReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; kind?: string; from?: string; to?: string }> }) {
  await requirePermission("fleet_documents", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const report: Report = sp.r && sp.r in REPORTS ? (sp.r as Report) : "expiring";
  const kind = KINDS.includes(sp.kind as OwnerKind) ? (sp.kind as OwnerKind) : undefined;
  const kinds = kind ? [kind] : undefined;
  const defFrom = report === "cost" ? `${today.slice(0, 4)}-01-01` : today;
  const defTo = report === "cost" ? today : addDays(today, 60);
  const from = sp.from && ISO.test(sp.from) ? sp.from : defFrom;
  const to = sp.to && ISO.test(sp.to) ? sp.to : defTo;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ r: report, kind, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `?${p}`;
  };

  return (
    <>
      <PageHeader title="تقارير الوثائق" description="ما ينتهي قريباً، وما انتهى ولم يُجدَّد، والوثائق الإلزامية الناقصة، ورسوم الإصدار والتجديد لكل مركبة وسائق.">
        <div className="flex items-center gap-2 print:hidden">
          <ExportButton filename={`تقرير-الوثائق-${REPORTS[report]}`} />
          <PrintButton />
          <Link href="/fleet-documents" className="ps-2 text-sm text-brand-700 hover:underline">
            → سجل الوثائق
          </Link>
        </div>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2 text-sm print:hidden">
        {(Object.keys(REPORTS) as Report[]).map((r) => (
          <Link
            key={r}
            href={`?r=${r}${kind ? `&kind=${kind}` : ""}`}
            className={`rounded-full px-3.5 py-1.5 transition ${report === r ? "bg-asphalt-900 font-semibold text-brand-500" : "bg-white text-gray-600 shadow-sm hover:bg-brand-50"}`}
          >
            {REPORTS[r]}
          </Link>
        ))}
      </div>

      <form method="get" className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm print:hidden">
        <input type="hidden" name="r" value={report} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">صاحب الوثيقة</span>
          <select name="kind" defaultValue={kind ?? ""} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">الكل</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {OWNER_KINDS[k].plural}
              </option>
            ))}
          </select>
        </label>
        {(report === "expiring" || report === "cost") && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">من</span>
              <DateInput name="from" defaultValue={from} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-gray-700">إلى</span>
              <DateInput name="to" defaultValue={to} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
          </>
        )}
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 hover:bg-brand-500">عرض</button>
        {report === "expiring" &&
          [7, 30, 60, 90].map((d) => (
            <Link key={d} href={qs({ from: today, to: addDays(today, d) })} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200">
              {d} يوماً
            </Link>
          ))}
      </form>

      <p className="mb-3 hidden text-sm text-gray-600 print:block">
        {REPORTS[report]} {report === "expiring" || report === "cost" ? `من ${from} إلى ${to}` : `في ${today}`}
        {kind ? ` · ${OWNER_KINDS[kind].plural}` : ""}
      </p>

      {report === "expiring" && <Expiring today={today} from={from} to={to} kinds={kinds} />}
      {report === "expired" && <Expiring today={today} to={addDays(today, -1)} kinds={kinds} expired />}
      {report === "missing" && <Missing kinds={kinds} />}
      {report === "cost" && <Costs from={from} to={to} kinds={kinds} />}
    </>
  );
}

async function Expiring({ today, from, to, kinds, expired }: { today: string; from?: string; to: string; kinds?: OwnerKind[]; expired?: boolean }) {
  const rows = (await currentDocuments(db, { expiringBy: to, expiringFrom: from })).filter((r) => !kinds || kinds.includes(r.ownerKind));
  return (
    <RTable name={expired ? "وثائق منتهية" : "وثائق تنتهي خلال الفترة"} head={["صاحب الوثيقة", "", "الوثيقة", "الرقم", "الانتهاء", "الحالة", "مرحلة التنبيه"]}>
      {rows.length === 0 && (
        <tr>
          <C colSpan={7} className="py-8 text-center text-gray-400">
            {expired ? "لا توجد وثائق منتهية" : "لا توجد وثائق تنتهي في هذه الفترة"}
          </C>
        </tr>
      )}
      {rows.map((r) => (
        <tr key={r.doc.id}>
          <C className="font-medium">
            <Link href={`/fleet-documents/owner/${r.ownerKind}-${r.ownerId}`} className="hover:text-brand-700 hover:underline">
              {r.owner}
            </Link>
          </C>
          <C className="text-xs text-gray-500">{OWNER_KINDS[r.ownerKind].label}</C>
          <C>{r.type.nameAr}</C>
          <C num>{r.doc.number ?? "—"}</C>
          <C num>{r.doc.expiryDate}</C>
          <C>
            <ExpiryBadge expiryDate={r.doc.expiryDate} today={today} alertDays={r.type.alertDays} />
          </C>
          <C className="text-xs text-gray-600">{alertStage(r.doc.expiryDate, today, r.type.alertDays)?.label ?? "لم يبدأ التنبيه"}</C>
        </tr>
      ))}
    </RTable>
  );
}

async function Missing({ kinds }: { kinds?: OwnerKind[] }) {
  const rows = await missingDocuments(db, kinds);
  return (
    <RTable name="وثائق إلزامية ناقصة" head={["صاحب الوثيقة", "", "الوثيقة الناقصة", "أثر الانتهاء", ""]}>
      {rows.length === 0 && (
        <tr>
          <C colSpan={5} className="py-8 text-center text-gray-400">
            كل الوثائق الإلزامية مسجلة
          </C>
        </tr>
      )}
      {rows.map(({ owner, type }) => (
        <tr key={`${owner.kind}-${owner.id}-${type.id}`}>
          <C className="font-medium">{owner.label}</C>
          <C className="text-xs text-gray-500">{OWNER_KINDS[owner.kind].label}</C>
          <C>{type.nameAr}</C>
          <C className="text-xs">{type.blocking === "block" ? "تمنع التشغيل" : type.blocking === "international" ? "تمنع الدولي" : "تنبيه"}</C>
          <C>
            <Link href={`/fleet-documents/owner/${owner.kind}-${owner.id}?add=${type.id}`} className="text-xs font-medium text-brand-700 hover:underline print:hidden">
              + إضافة
            </Link>
          </C>
        </tr>
      ))}
    </RTable>
  );
}

async function Costs({ from, to, kinds }: { from: string; to: string; kinds?: OwnerKind[] }) {
  const rows = (await renewalCosts(db, from, to)).filter((r) => !kinds || kinds.includes(r.kind));
  const total = rows.reduce((a, r) => a + r.total, 0);
  const fmt = (v: number) => v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <RTable name="رسوم الإصدار والتجديد" head={["صاحب الوثيقة", "", "عدد الوثائق", "التفصيل", "الإجمالي (ر.س)"]}>
      {rows.length === 0 && (
        <tr>
          <C colSpan={5} className="py-8 text-center text-gray-400">
            لا توجد رسوم مسجلة في الفترة؛ تُسجَّل في حقل «رسوم الإصدار أو التجديد» عند إضافة الوثيقة
          </C>
        </tr>
      )}
      {rows.map((r) => (
        <tr key={`${r.kind}-${r.id}`}>
          <C className="font-medium">{r.label}</C>
          <C className="text-xs text-gray-500">{OWNER_KINDS[r.kind].label}</C>
          <C num>{r.count}</C>
          <C className="text-xs text-gray-600">
            {[...r.types].map(([t, v]) => `${t}: ${fmt(v)}`).join("، ")}
          </C>
          <C num className="font-medium">
            {fmt(r.total)}
          </C>
        </tr>
      ))}
      {rows.length > 0 && (
        <tr className="bg-gray-50 font-semibold">
          <C colSpan={4}>الإجمالي</C>
          <C num>{fmt(total)}</C>
        </tr>
      )}
    </RTable>
  );
}
