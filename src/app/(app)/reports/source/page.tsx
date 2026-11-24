import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { fmtDate } from "@/lib/format";
import { pageOf, PAGE_SIZE } from "@/lib/paging";
import { parseSource, sourceDocs, sourceHref, sourceLines, type SourceFilter } from "@/lib/source-lines";
import { TAX_BEHAVIORS, isTaxBehavior } from "@/data/tax-codes";
import { DrillBack } from "@/components/drill";
import { Pager } from "@/components/ui";
import { C, money, ReportHeader, RTable, SOURCE, SourceLink, type ReportParams } from "../report-ui";

/**
 * «مصدر الرقم» (طلب أحمد 2026-11-24): القيود أو المستندات التي حُسب منها الرقم المنقور في اللوحة أو أي تقرير،
 * بنفس شروطه، ومجموعها يُقارن به (✓ يطابق). كل شرط يُزال بـ× لتوسيع النتيجة، وكل سطر يفتح قيده ومستنده.
 */
export default async function SourcePage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  const sp = await searchParams;
  const today = todayRiyadh();
  const f = parseSource(sp, today);
  // حركة المخزون كمية وقيمة لمن يرى المخزون (تقريرها له)، وكل ما سواها للتقارير المالية
  await requirePermission(f.doc === "stock" ? "inventory" : "financial_reports", "view");
  const { page } = pageOf(typeof sp.page === "string" ? sp.page : undefined);
  const chips = await describe(f);
  const period = f.mode === "bal" && !f.from ? `حتى ${fmtDate(f.to)}` : f.from ? `من ${fmtDate(f.from)} إلى ${fmtDate(f.to)}` : `حتى ${fmtDate(f.to)}`;

  const drop = (key: keyof SourceFilter) => sourceHref({ ...f, [key]: undefined, expected: undefined });

  const docs = f.doc ? await sourceDocs(db, f) : null;
  const data = f.doc ? null : await sourceLines(db, f, page);
  const value = docs ? Math.round(docs.reduce((t, d) => t + d.amount, 0) * 100) / 100 : data!.value;
  const match = f.expected == null ? null : Math.abs(value - f.expected) < 0.01;

  return (
    <>
      <ReportHeader title={`مصدر الرقم: ${f.title}`} period={period} filename={`مصدر-${f.title}`} note={docs ? "من المستندات التي حُسب منها الرقم" : "من القيود المرحّلة"} />

      <div
        className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-3 text-sm print:hidden ${match === false ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}
        data-source-match={match == null ? "" : match ? "yes" : "no"}
      >
        <span className="min-w-0 flex-1">
          {match === false ? (
            <>
              المجموع هنا <b className="ltr-nums">{money(value, false)}</b> والرقم الذي نقرته <b className="ltr-nums">{money(f.expected!, false)}</b>. الفرق <b className="ltr-nums">{money(value - f.expected!, false)}</b> قد يكون من قيد سُجّل أو أُرجع بعد فتح الصفحة؛ أعد تحميل التقرير.
            </>
          ) : (
            <>
              {match ? "✓ " : ""}المجموع <b className="ltr-nums">{money(value, false)}</b>
              {match ? " يساوي الرقم الذي نقرته." : "."}
            </>
          )}
        </span>
        <DrillBack />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs print:hidden">
        {chips.map((c) => (
          <span key={c.label} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white py-1 ps-3 pe-1.5 shadow-sm ring-1 ring-gray-200">
            <span className="min-w-0 truncate">
              {c.label}: <b>{c.value}</b>
            </span>
            {c.key ? (
              <Link href={drop(c.key)} title="إزالة هذا الشرط لتوسيع النتيجة" aria-label={`إزالة ${c.label}`} className="grid size-5 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-500 hover:bg-brand-100">
                ×
              </Link>
            ) : (
              <span className="w-1" />
            )}
          </span>
        ))}
        <Link href={`/reports/general-ledger?from=${f.from ?? `${f.to.slice(0, 4)}-01-01`}&to=${f.to}`} className="ms-1 text-brand-700 hover:underline">
          الأستاذ العام للفترة
        </Link>
      </div>

      {docs ? (
        <RTable name="مصدر الرقم" head={["التاريخ", "المستند", "الجهة", "البيان", "المبلغ"]}>
          {docs.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                لا توجد مستندات بهذه الشروط
              </td>
            </tr>
          )}
          {docs.map((d, i) => (
            <tr key={i}>
              <C className="ltr-nums whitespace-nowrap">{fmtDate(d.date)}</C>
              <C className="whitespace-nowrap">
                <Link href={d.href} prefetch={false} className="drill ltr-nums">
                  {d.number}
                </Link>
              </C>
              <C>{d.party ?? ""}</C>
              <C className="text-xs text-gray-600">{d.note ?? ""}</C>
              <C num>{money(d.amount)}</C>
            </tr>
          ))}
          <tr className="bg-asphalt-900/5 font-bold text-brand-900">
            <C colSpan={4}>الإجمالي ({docs.length})</C>
            <C num>{money(value, false)}</C>
          </tr>
        </RTable>
      ) : (
        <>
          <RTable name="مصدر الرقم" head={["التاريخ", "القيد", "المستند", "الحساب", "الجهة", "البيان", "مركز التكلفة", "مدين", "دائن", "الرصيد"]}>
            {f.mode === "bal" && f.from && (
              <tr className="bg-gray-50 font-semibold">
                <C className="ltr-nums">{fmtDate(f.from)}</C>
                <C colSpan={5}>رصيد افتتاحي</C>
                <C />
                <C />
                <C />
                <C num>{money(data!.opening, false)}</C>
              </tr>
            )}
            {data!.lines.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                  لا توجد قيود بهذه الشروط
                </td>
              </tr>
            )}
            {data!.lines.map((l, i) => (
              <tr key={i}>
                <C className="ltr-nums whitespace-nowrap">{fmtDate(l.entry_date)}</C>
                <C className="ltr-nums text-xs whitespace-nowrap">
                  <Link href={`/journal/${l.entry_id}`} prefetch={false} className="drill">
                    {l.number}
                  </Link>
                </C>
                <C className="text-xs whitespace-nowrap">
                  <SourceLink type={l.source_type} id={l.source_id} entryId={l.entry_id} />
                </C>
                <C className="text-xs whitespace-nowrap">
                  <span className="ltr-nums text-gray-400">{l.account_code}</span> {l.account_name}
                </C>
                <C className="text-xs">{l.party ?? ""}</C>
                <C className="max-w-sm">{l.description}</C>
                <C className="text-xs text-gray-500">{l.cost_center ?? ""}</C>
                <C num>{money(l.debit)}</C>
                <C num>{money(l.credit)}</C>
                <C num className={`font-medium ${l.balance < 0 ? "text-red-600" : ""}`}>{money(l.balance, false)}</C>
              </tr>
            ))}
            <tr className="bg-asphalt-900/5 font-bold text-brand-900">
              <C colSpan={7}>الإجمالي ({data!.count.toLocaleString("en")} سطراً)</C>
              <C num>{money(data!.debit, false)}</C>
              <C num>{money(data!.credit, false)}</C>
              <C num>{money(f.mode === "bal" ? data!.closing : data!.net, false)}</C>
            </tr>
          </RTable>
          <Pager page={page} size={PAGE_SIZE} total={data!.count} hrefFor={(p) => `${sourceHref(f)}&page=${p}`} />
          <p className="mt-2 text-xs text-gray-500">الرصيد الموجب مدين والسالب (بين قوسين) دائن. {f.sign === -1 ? "الرقم المنقور بطبيعته الدائنة، فيساوي الدائن ناقص المدين." : ""}</p>
        </>
      )}
    </>
  );
}

/** الشروط بأسماء يفهمها المستخدم، وكل شرط يمكن إزالته عدا الفترة. */
async function describe(f: SourceFilter) {
  const out: { label: string; value: string; key?: keyof SourceFilter }[] = [];
  if (f.codes?.length) {
    const exact = f.codes.map((c) => c.replace(/^=/, ""));
    const accs = await db.select({ code: s.accounts.code, name: s.accounts.nameAr }).from(s.accounts).where(inArray(s.accounts.code, exact));
    const name = (c: string) => accs.find((a) => a.code === c.replace(/^=/, ""))?.name;
    const groups: Record<string, string> = { "1": "الأصول", "2": "الالتزامات", "3": "حقوق الملكية", "4": "الإيرادات", "5": "تكاليف التشغيل", "6": "المصروفات الإدارية", "7": "تكاليف التمويل والبنود الأخرى" };
    out.push({ label: f.codes.length > 1 ? "الحسابات" : "الحساب", value: f.codes.map((c) => `${c.replace(/^=/, "")} ${name(c) ?? groups[c] ?? ""}`.trim()).join("، "), key: "codes" });
  }
  if (f.vehicleId) {
    const [v] = await db.select({ plate: s.vehicles.plate }).from(s.vehicles).where(eq(s.vehicles.id, f.vehicleId));
    out.push({ label: "المركبة", value: v?.plate ?? `#${f.vehicleId}`, key: "vehicleId" });
  }
  if (f.costCenterId === 0) out.push({ label: "مركز التكلفة", value: "أي مركز تكلفة", key: "costCenterId" });
  else if (f.costCenterId) {
    const [c] = await db.select({ name: s.costCenters.nameAr }).from(s.costCenters).where(eq(s.costCenters.id, f.costCenterId));
    out.push({ label: "مركز التكلفة", value: c?.name ?? `#${f.costCenterId}`, key: "costCenterId" });
  }
  if (f.partyId === 0) out.push({ label: "الجهة", value: "السطور المربوطة بجهة فقط", key: "partyId" });
  else if (f.partyId) {
    const [p] = await db.select({ name: s.parties.nameAr }).from(s.parties).where(eq(s.parties.id, f.partyId));
    out.push({ label: "الجهة", value: p?.name ?? `#${f.partyId}`, key: "partyId" });
  }
  if (f.driverId != null) {
    const [d] = f.driverId
      ? await db.select({ name: s.employees.nameAr }).from(s.drivers).innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId)).where(eq(s.drivers.id, f.driverId))
      : [{ name: "دون سائق" }];
    out.push({ label: "السائق", value: d?.name ?? `#${f.driverId}`, key: "driverId" });
  }
  if (f.fleet) out.push({ label: "النطاق", value: f.fleet === "v" ? "على مراكز تكلفة المركبات" : "ما يُعرف سائقه أو مركبته", key: "fleet" });
  if (f.tax) out.push({ label: "نوع الضريبة", value: isTaxBehavior(f.tax) ? TAX_BEHAVIORS[f.tax].label : f.tax, key: "tax" });
  if (f.sourceTypes?.length) out.push({ label: "نوع المستند", value: f.sourceTypes.map((t) => SOURCE[t]?.label ?? (t === "manual" ? "قيد يدوي" : t)).join("، "), key: "sourceTypes" });
  if (f.excludeSourceTypes?.length) out.push({ label: "عدا", value: f.excludeSourceTypes.map((t) => SOURCE[t]?.label ?? t).join("، "), key: "excludeSourceTypes" });
  if (f.touch?.length) out.push({ label: "قيود تمس", value: f.touch.map((c) => (c === "1101" ? "الصناديق" : c === "1102" ? "البنوك" : c)).join(" و"), key: "touch" });
  if (f.side) out.push({ label: "الطرف", value: f.side === "d" ? "المدين فقط" : "الدائن فقط", key: "side" });
  if (f.doc === "open") out.push({ label: "المستندات", value: `${f.supplier ? "فواتير الموردين" : "فواتير المبيعات"} المفتوحة${f.dmin != null || f.dmax != null ? ` (${f.dmin ?? 0}${f.dmax != null ? `–${f.dmax}` : "+"} يوم تأخير)` : ""}` });
  if (f.productId) {
    const [p] = await db.select({ name: s.products.nameAr }).from(s.products).where(eq(s.products.id, f.productId));
    out.push({ label: "الصنف", value: p?.name ?? `#${f.productId}`, key: "productId" });
  }
  if (f.warehouseId) {
    const [w] = await db.select({ name: s.warehouses.nameAr }).from(s.warehouses).where(eq(s.warehouses.id, f.warehouseId));
    out.push({ label: "المستودع", value: w?.name ?? `#${f.warehouseId}`, key: "warehouseId" });
  }
  return out;
}
