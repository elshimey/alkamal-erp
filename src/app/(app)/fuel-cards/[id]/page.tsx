import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { statementDetail } from "@/lib/fuel-cards";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { autoMatchAction, deleteStatementAction, matchAction, postExpenseAction, statusAction, unpostAction } from "../actions";

const fmt = (v: number | string) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("fuel_cards", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const d = await statementDetail(db, id).catch(() => null);
  if (!d) notFound();
  const { st, provider, lines, unmatchedSystem, candidates, summary } = d;
  const open = st.status === "open";
  const canUpdate = open && can(user.perms, "fuel_cards", "update");
  const canPost = open && can(user.perms, "fuel_cards", "approve");
  const canRevert = open && can(user.perms, "fuel_cards", "revert");
  const closingDiff = st.closingBalance == null ? null : Math.round((Number(st.closingBalance) - summary.ledgerBalance) * 100) / 100;

  return (
    <>
      <PageHeader title={`كشف بطاقات الوقود ${st.number}`} description={`${provider ?? "بلا مزود"} · من ${st.periodFrom} إلى ${st.periodTo}`}>
        <div className="flex flex-wrap items-center gap-2">
          {st.status === "reconciled" ? <Badge tone="green">مُطابق ومقفل</Badge> : <Badge tone="amber">مفتوح</Badge>}
          {canUpdate && (
            <ActionForm action={autoMatchAction.bind(null, id)}>
              <SubmitButton variant="secondary">مطابقة تلقائية</SubmitButton>
            </ActionForm>
          )}
          {can(user.perms, "fuel_cards", "approve") && (
            <ActionForm action={statusAction.bind(null, id, open ? "reconciled" : "open")}>
              <SubmitButton variant={open ? "primary" : "secondary"}>{open ? "إقفال الكشف مطابقاً" : "إعادة فتح الكشف"}</SubmitButton>
            </ActionForm>
          )}
          <Link href="/fuel-cards" className="text-sm font-medium text-brand-700 hover:underline">
            ← كل الكشوف
          </Link>
        </div>
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["إجمالي الكشف", fmt(summary.total), ""],
          ["مطابق مع الشحنات", fmt(summary.matched), "text-green-700"],
          ["قُيد مصروفاً", fmt(summary.posted), "text-blue-700"],
          ["سطور غير محلولة", String(summary.unresolved), summary.unresolved ? "text-amber-700" : "text-green-700"],
          ["مسجل ولم يظهر في الكشف", fmt(summary.systemUnmatched), summary.systemUnmatched ? "text-red-700" : ""],
          ["رصيد 1106 في نهاية الفترة", fmt(summary.ledgerBalance), ""],
        ].map(([l, v, c]) => (
          <div key={l} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-xs text-gray-500">{l}</div>
            <div className={`ltr-nums font-display text-lg font-semibold ${c}`}>{v}</div>
          </div>
        ))}
      </div>
      {closingDiff != null && (
        <p className={`mb-6 rounded-xl px-4 py-3 text-sm ${closingDiff === 0 ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
          الرصيد الختامي في الكشف <b className="ltr-nums">{fmt(st.closingBalance!)}</b>
          {closingDiff === 0 ? " يساوي رصيد حساب بطاقات الوقود في الدفاتر." : <> ويختلف عن رصيد الدفاتر بمبلغ <b className="ltr-nums">{fmt(closingDiff)}</b>؛ راجع التعبئات غير المسجلة وشحنات الرصيد.</>}
        </p>
      )}

      <h2 className="mb-3 font-semibold text-brand-900">سطور الكشف</h2>
      <div className="mb-8">
        <Table head={["#", "التاريخ", "اللوحة", "المحطة", "المرجع", "اللترات", "المبلغ", "الحالة", "الإجراء"]}>
          {lines.length === 0 && <EmptyRow cols={9}>لا سطور</EmptyRow>}
          {lines.map(({ l, vehicle, entry, fuel }) => {
            const options = candidates.filter((f) => !l.vehicleId || f.vehicleId === l.vehicleId);
            return (
              <tr key={l.id}>
                <Td className="ltr-nums text-xs text-gray-400">{l.lineNo}</Td>
                <Td className="ltr-nums whitespace-nowrap">{l.txnDate}</Td>
                <Td>
                  {vehicle ?? l.plate ?? "—"}
                  {!l.vehicleId && l.plate && <div className="text-xs text-red-600">لوحة غير معرّفة</div>}
                </Td>
                <Td className="text-xs">{l.station ?? "—"}</Td>
                <Td className="ltr-nums text-xs">{l.reference ?? "—"}</Td>
                <Td className="ltr-nums">{l.liters ?? "—"}</Td>
                <Td className="ltr-nums font-semibold">{fmt(l.amount)}</Td>
                <Td>
                  {fuel ? (
                    <div>
                      <Badge tone="green">مطابق</Badge>
                      <Link href={`/waybills/${fuel.waybillId}`} className="ltr-nums ms-1 text-xs text-brand-700 hover:underline">
                        {fuel.waybill}
                      </Link>
                    </div>
                  ) : entry ? (
                    <div>
                      <Badge tone="blue">قُيد مصروفاً</Badge>
                      <span className="ltr-nums ms-1 text-xs text-gray-500">{entry}</span>
                    </div>
                  ) : (
                    <Badge tone="amber">غير مسجل</Badge>
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-2">
                    {canUpdate && !entry && (
                      <ActionForm action={matchAction.bind(null, id, l.id)} resetOnSuccess={false} className="flex items-center gap-1">
                        <select name="fuelId" defaultValue={l.fuelId ?? ""} className="h-8 max-w-48 rounded-md border border-gray-300 px-1 text-xs">
                          <option value="">— بلا مطابقة —</option>
                          {fuel && (
                            <option value={fuel.id}>
                              {fuel.waybill} · {fuel.date} · {fmt(fuel.total)}
                            </option>
                          )}
                          {options.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.waybill} · {f.date} · {f.plate ?? ""} · {fmt(f.total)}
                            </option>
                          ))}
                        </select>
                        <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs">
                          حفظ
                        </SubmitButton>
                      </ActionForm>
                    )}
                    {canPost && !fuel && !entry && (
                      <ActionForm action={postExpenseAction.bind(null, id, l.id)}>
                        <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs">
                          قيد ديزل على المركبة
                        </SubmitButton>
                      </ActionForm>
                    )}
                    {canRevert && entry && (
                      <ActionForm action={unpostAction.bind(null, id, l.id)}>
                        <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs text-red-700">
                          حذف القيد
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      </div>

      <h2 className="mb-1 font-semibold text-brand-900">مسجل في الشحنات ولم يظهر في الكشف</h2>
      <p className="mb-3 text-sm text-gray-500">تعبئات «بطاقة وقود» في هذه الفترة لم تطابق أي سطر في كشف؛ قد تكون مكررة أو بمبلغ خاطئ أو على بطاقة أخرى.</p>
      <div className="mb-8">
        <Table head={["الشحنة", "التاريخ", "المركبة", "اللترات", "المبلغ شامل الضريبة", "رقم الفاتورة"]}>
          {unmatchedSystem.length === 0 && <EmptyRow cols={6}>كل التعبئات المسجلة ظهرت في الكشف</EmptyRow>}
          {unmatchedSystem.map((f) => (
            <tr key={f.id}>
              <Td className="ltr-nums">
                <Link href={`/waybills/${f.waybillId}`} className="text-brand-700 hover:underline">
                  {f.waybill}
                </Link>
              </Td>
              <Td className="ltr-nums">{f.date}</Td>
              <Td>{f.plate ?? "—"}</Td>
              <Td className="ltr-nums">{f.liters ?? "—"}</Td>
              <Td className="ltr-nums font-semibold">{fmt(f.total)}</Td>
              <Td className="ltr-nums text-xs">{f.invoiceNumber ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      </div>

      {open && can(user.perms, "fuel_cards", "delete") && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-400 hover:text-red-700">حذف الكشف</summary>
          <ActionForm action={deleteStatementAction.bind(null, id)} className="mt-2">
            <SubmitButton variant="secondary" className="text-red-700">
              تأكيد حذف الكشف وسطوره
            </SubmitButton>
          </ActionForm>
        </details>
      )}
    </>
  );
}
