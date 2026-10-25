import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DEFAULT_ECL_RATES, ECL_BUCKETS, eclAging, eclCompute, eclEntries, provisionBalance, type EclBucket } from "@/lib/ecl";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { postProvision, removeProvision } from "./actions";
import { fmt } from "@/lib/format";
import { DateInput } from "@/components/date-input";

export default async function EclPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("journal_entries", "view");
  const sp = await searchParams;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf ?? "") ? sp.asOf! : todayRiyadh();
  const rates = Object.fromEntries(ECL_BUCKETS.map((b) => {
    const v = Number(sp[b.key]);
    return [b.key, sp[b.key] != null && v >= 0 && v <= 100 ? v : DEFAULT_ECL_RATES[b.key]];
  })) as Record<EclBucket, number>;
  const [aging, current, history] = await Promise.all([eclAging(db, asOf), provisionBalance(db, asOf), eclEntries(db)]);
  const { customers, buckets, total, required } = eclCompute(aging, rates);
  const diff = Math.round((required - current) * 100) / 100;
  const canPost = can(user.perms, "journal_entries", "create");
  const canDelete = can(user.perms, "journal_entries", "delete");

  return (
    <>
      <PageHeader title="مخصص الديون المشكوك فيها" description="الخسائر الائتمانية المتوقعة (IFRS 9، الطريقة المبسطة): نسبة على أرصدة العملاء المفتوحة حسب مدة التأخير، ويُقيد الفرق عن رصيد المخصص الحالي (1104) على مصروف 6112." />

      <Card title="التاريخ والنسب" className="mb-6">
        <form className="grid items-end gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-gray-600">في تاريخ</span>
            <DateInput name="asOf" defaultValue={asOf} className="h-9 w-full rounded-lg border border-gray-300 px-3 text-sm" />
          </label>
          {ECL_BUCKETS.map((b) => (
            <label key={b.key} className="text-sm">
              <span className="mb-1 block text-xs text-gray-600">{b.label} %</span>
              <input name={b.key} defaultValue={rates[b.key]} inputMode="decimal" dir="ltr" className="ltr-nums h-9 w-full rounded-lg border border-gray-300 px-2 text-sm" />
            </label>
          ))}
          <button className="h-9 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium shadow-sm hover:bg-gray-50 sm:col-span-full sm:w-fit">احسب</button>
        </form>
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {[
          ["أرصدة العملاء المفتوحة", total],
          ["المخصص المطلوب", required],
          ["رصيد المخصص الحالي", current],
          [diff >= 0 ? "المطلوب تكوينه" : "المطلوب رده", Math.abs(diff)],
        ].map(([l, v], i) => (
          <div key={i} className={`rounded-2xl p-4 shadow-sm ${i === 3 ? "bg-asphalt-900 text-white" : "bg-white"}`}>
            <div className={`text-xs ${i === 3 ? "text-white/70" : "text-gray-500"}`}>{l}</div>
            <div className="ltr-nums font-display text-xl font-semibold">{fmt(v as number)}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Table head={["الشريحة", "الرصيد", "النسبة", "المخصص"]} stack={false}>
          {buckets.map((b) => (
            <tr key={b.key}>
              <Td>{b.label}</Td>
              <Td className="ltr-nums">{fmt(b.amount)}</Td>
              <Td className="ltr-nums">{b.rate}%</Td>
              <Td className="ltr-nums font-semibold">{fmt(b.provision)}</Td>
            </tr>
          ))}
        </Table>
        <Card title="ترحيل القيد">
          {diff === 0 ? (
            <p className="text-sm text-green-700">المخصص الحالي يساوي المطلوب في هذا التاريخ.</p>
          ) : (
            <>
              <p className="mb-4 text-sm text-gray-700">
                {diff > 0 ? "مدين مصروف الخسائر الائتمانية 6112، دائن المخصص 1104" : "مدين المخصص 1104، دائن مصروف الخسائر الائتمانية 6112"} بمبلغ{" "}
                <b className="ltr-nums">{fmt(Math.abs(diff))}</b> ريال في <span className="ltr-nums">{asOf}</span>.
              </p>
              {canPost && (
                <ActionForm action={postProvision}>
                  <input type="hidden" name="asOf" value={asOf} />
                  {ECL_BUCKETS.map((b) => (
                    <input key={b.key} type="hidden" name={b.key} value={rates[b.key]} />
                  ))}
                  <SubmitButton>ترحيل قيد المخصص</SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </Card>
      </div>

      <h2 className="mb-3 font-semibold text-brand-900">حسب العميل</h2>
      <div className="mb-8">
        <Table head={["العميل", ...ECL_BUCKETS.map((b) => b.label), "الإجمالي", "المخصص"]}>
          {customers.length === 0 && <EmptyRow cols={9}>لا توجد أرصدة مفتوحة</EmptyRow>}
          {customers.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium">{c.name}</Td>
              {ECL_BUCKETS.map((b) => (
                <Td key={b.key} className="ltr-nums">
                  {c[b.key] ? fmt(c[b.key]) : "—"}
                </Td>
              ))}
              <Td className="ltr-nums">{fmt(c.total)}</Td>
              <Td className="ltr-nums font-semibold">{fmt(c.provision)}</Td>
            </tr>
          ))}
        </Table>
      </div>

      <h2 className="mb-3 font-semibold text-brand-900">قيود المخصص السابقة</h2>
      <Table head={["القيد", "التاريخ", "البيان", ""]}>
        {history.length === 0 && <EmptyRow cols={4}>لا توجد قيود بعد</EmptyRow>}
        {history.map((h) => (
          <tr key={h.id}>
            <Td className="ltr-nums">
              <Link href={`/journal?open=${h.id}`} className="text-brand-700 hover:underline">
                {h.number}
              </Link>
            </Td>
            <Td className="ltr-nums">{h.date}</Td>
            <Td className="text-xs text-gray-600">{h.description}</Td>
            <Td>
              {canDelete && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-400 hover:text-red-700">حذف</summary>
                  <ActionForm action={removeProvision.bind(null, h.id)} className="mt-1">
                    <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs text-red-700">
                      تأكيد الحذف
                    </SubmitButton>
                  </ActionForm>
                </details>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
