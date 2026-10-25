import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listReconciliations, reconcilableAccounts } from "@/lib/reconciliation";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { createReconciliationAction } from "./actions";
import { fmt } from "@/lib/format";
import { AddModeBar, ListActions } from "@/components/list-actions";

export default async function ReconciliationsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const user = await requirePermission("accounts", "view");
  const [rows, accounts] = await Promise.all([listReconciliations(db), reconcilableAccounts(db)]);
  const canCreate = can(user.perms, "accounts", "update");

  const adding = (await searchParams).add === "1" && !!(canCreate);
  return (
    <>
      <PageHeader
        title="التسوية البنكية"
        description="أدخل رصيد كشف البنك في تاريخه، ثم أشّر على الحركات التي ظهرت في الكشف. حين يصبح الفرق صفراً تكتمل التسوية، وما لم يظهر يبقى معلقاً للشهر التالي."
      >
        <div className="flex flex-wrap items-center gap-3">
        <Link href="/bank-accounts" className="text-sm text-brand-700 hover:underline">
          الحسابات البنكية
        </Link>
          {!adding && <ListActions newHref={(canCreate) && "/bank-accounts/reconcile?add=1"} newLabel="تسوية جديدة" />}
        </div>
      </PageHeader>

      {adding && <AddModeBar backHref="/bank-accounts/reconcile" backLabel="التسوية البنكية" title="تسوية جديدة" />}
      {adding && (
        <Card className="mb-6">
          <ActionForm action={createReconciliationAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="الحساب">
              <Select name="accountId" required defaultValue="">
                <option value="" disabled>
                  اختر البنك أو الصندوق
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} – {a.nameAr} {a.currencyCode && a.currencyCode !== "SAR" ? `(${a.currencyCode})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="تاريخ الكشف">
              <Input name="statementDate" type="date" required defaultValue={todayRiyadh()} />
            </Field>
            <Field label="الرصيد في الكشف" hint="بعملة الحساب">
              <Input name="statementBalance" inputMode="decimal" required dir="ltr" placeholder="0.00" />
            </Field>
            <Field label="ملاحظات">
              <Input name="notes" placeholder="اختياري" />
            </Field>
            <div className="col-span-full">
              <SubmitButton>ابدأ التسوية</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
      {!adding && (
        <>
      <Table head={["الرقم", "الحساب", "تاريخ الكشف", "رصيد الكشف", "الحالة"]}>
        {rows.length === 0 && <EmptyRow cols={5}>لا توجد تسويات بعد</EmptyRow>}
        {rows.map(({ r, account, code, currency }) => (
          <tr key={r.id} className="hover:bg-gray-50">
            <Td>
              <Link href={`/bank-accounts/reconcile/${r.id}`} className="ltr-nums font-medium text-brand-700 hover:underline">
                {r.number}
              </Link>
            </Td>
            <Td>
              <span className="ltr-nums text-gray-500">{code}</span> {account}
            </Td>
            <Td className="ltr-nums">{r.statementDate}</Td>
            <Td className="ltr-nums">
              {fmt(Number(r.statementBalance))} <span className="text-xs text-gray-400">{currency ?? "SAR"}</span>
            </Td>
            <Td>{r.status === "completed" ? <Badge tone="green">مكتملة</Badge> : <Badge tone="amber">مسودة</Badge>}</Td>
          </tr>
        ))}
      </Table>
        </>
      )}
    </>
  );
}
