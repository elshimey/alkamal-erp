import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listTransfers, transferAccounts } from "@/lib/transfers";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { removeTransfer, saveTransfer } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function TransfersPage() {
  const user = await requirePermission("payments", "view");
  const [accounts, rows] = await Promise.all([transferAccounts(db), listTransfers(db)]);
  const canCreate = can(user.perms, "payments", "create");
  const canDelete = can(user.perms, "payments", "delete");
  const label = (a: (typeof accounts)[number]) => `${a.code} ${a.nameAr}${a.currencyCode && a.currencyCode !== "SAR" ? ` (${a.currencyCode})` : ""}`;

  return (
    <>
      <PageHeader title="التحويل بين الحسابات" description="نقل مبلغ بين بنك وصندوق، أو بين بنكين، أو شحن رصيد بطاقات الوقود. يُقيد فوراً، والرسوم على الرسوم البنكية، وفرق العملة على فروق العملة.">
        <Link href="/bank-accounts" className="text-sm font-medium text-brand-700 hover:underline">
          ← البنوك والصناديق
        </Link>
      </PageHeader>

      {canCreate && (
        <Card title="تحويل جديد" className="mb-6">
          <ActionForm action={saveTransfer} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="التاريخ">
              <Input name="date" type="date" required defaultValue={todayRiyadh()} />
            </Field>
            <Field label="من حساب">
              <Select name="fromAccountId" required defaultValue="">
                <option value="" disabled>
                  اختر
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {label(a)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="إلى حساب">
              <Select name="toAccountId" required defaultValue="">
                <option value="" disabled>
                  اختر
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {label(a)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="المبلغ" hint="بعملة الحساب المحوَّل منه">
              <Input name="amount" inputMode="decimal" dir="ltr" required />
            </Field>
            <Field label="المبلغ المستلم" hint="فقط إذا اختلفت العملتان">
              <Input name="receivedAmount" inputMode="decimal" dir="ltr" />
            </Field>
            <Field label="رسوم التحويل" hint="اختياري؛ تُخصم من الحساب المحوَّل منه">
              <Input name="fee" inputMode="decimal" dir="ltr" />
            </Field>
            <Field label="المرجع" hint="رقم الحوالة أو الإيصال">
              <Input name="reference" dir="ltr" />
            </Field>
            <Field label="ملاحظات">
              <Input name="notes" />
            </Field>
            <div className="col-span-full">
              <SubmitButton>تسجيل التحويل</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      <Table head={["الرقم", "التاريخ", "من", "إلى", "المبلغ", "المستلم", "الرسوم", "المرجع", "القيد", ""]}>
        {rows.length === 0 && <EmptyRow cols={10}>لا توجد تحويلات بعد</EmptyRow>}
        {rows.map(({ t, from, fromCode, fromCur, to, toCode, toCur, entry }) => (
          <tr key={t.id}>
            <Td className="ltr-nums font-medium whitespace-nowrap">{t.number}</Td>
            <Td className="ltr-nums whitespace-nowrap">{t.transferDate}</Td>
            <Td>
              <span className="ltr-nums text-xs text-gray-400">{fromCode}</span> {from}
            </Td>
            <Td>
              <span className="ltr-nums text-xs text-gray-400">{toCode}</span> {to}
            </Td>
            <Td className="ltr-nums font-semibold whitespace-nowrap">
              {fmt(t.amount)} <span className="text-xs text-gray-400">{fromCur ?? "SAR"}</span>
            </Td>
            <Td className="ltr-nums whitespace-nowrap">
              {fmt(t.receivedAmount)} <span className="text-xs text-gray-400">{toCur ?? "SAR"}</span>
            </Td>
            <Td className="ltr-nums">{Number(t.fee) ? fmt(t.fee) : "—"}</Td>
            <Td className="ltr-nums text-xs">{t.reference ?? "—"}</Td>
            <Td className="ltr-nums text-xs">
              {entry && t.journalEntryId ? (
                <Link href={`/journal?open=${t.journalEntryId}`} className="text-brand-700 hover:underline">
                  {entry}
                </Link>
              ) : (
                "—"
              )}
            </Td>
            <Td>
              {canDelete && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-400 hover:text-red-700">حذف</summary>
                  <ActionForm action={removeTransfer.bind(null, t.id)} className="mt-1">
                    <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs text-red-700">
                      تأكيد حذف التحويل وقيده
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
