import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { toAccountOptions } from "@/lib/lookups";
import { creditorAccounts, installmentPayFrom, installmentPlan, planPayments, reclassEntries } from "@/lib/installments";
import { addDays, addMonths } from "@/lib/installment-schedule";
import { todayRiyadh } from "@/lib/dates";
import { AccountField } from "@/components/account-field";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { DialogButton } from "@/components/dialog-button";
import { Badge, Card, Input, PageHeader, Table, Td } from "@/components/ui";
import { fmt, fmtDate } from "@/lib/format";
import { planAction, updateInstallmentAction } from "../actions";
import { InstallmentBadge, PayInstallmentButton, PayoffButton, type PayFrom } from "../pay-forms";

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: string; hint?: string }) {
  return (
    <Card>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ltr-nums ${tone ?? ""}`}>{fmt(value)}</p>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </Card>
  );
}

/** صفحة جدول الأقساط: أقساطه وحالاتها، والسداد والسداد المبكر، والفرق مع الدفتر، وإعادة تصنيف الجزء المتداول لقروض 2201. */
export default async function InstallmentPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("payments", "view");
  const id = Number((await params).id);
  const today = todayRiyadh();
  const plan = Number.isFinite(id) ? await installmentPlan(db, id, today) : null;
  if (!plan) notFound();
  const canPay = can(user.perms, "payments", "create");
  const canDelete = can(user.perms, "payments", "delete");
  const [payFrom, payments, reclass, creditors] = await Promise.all([installmentPayFrom(db), planPayments(db, id), reclassEntries(db, id), plan.isLongTerm ? creditorAccounts(db) : Promise.resolve([])]);
  const from: PayFrom = {
    suggested: await toAccountOptions(payFrom.suggested),
    all: await toAccountOptions(payFrom.all),
    first: String(payFrom.suggested.find((a) => a.code.startsWith("1102"))?.id ?? payFrom.suggested[0]?.id ?? ""),
  };
  const monthEnd = addDays(addMonths(`${today.slice(0, 7)}-01`, 1), -1);
  const current = creditors.find((a) => a.code.startsWith("2114"));
  const active = plan.status === "active";

  return (
    <>
      <PageHeader title={plan.name} description={`${plan.account} (${plan.code})${plan.party ? ` · ${plan.party}` : ""}${plan.vehicle ? ` · المركبة ${plan.vehicle}` : ""}`}>
        <Link href="/payments/installments" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
          ← الأقساط
        </Link>
        {active && canPay && plan.remaining > 0 && <PayoffButton planId={plan.id} owed={plan.owed} today={today} from={from} />}
      </PageHeader>

      {plan.status === "settled" && (
        <p className="mb-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
          سُدد هذا الجدول مبكراً في {fmtDate(plan.payoffDate)} وأُقفلت أقساطه الباقية.
        </p>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="الباقي من الأقساط" value={plan.remaining} hint={`${plan.items.filter((i) => i.state === "paid").length} من ${plan.items.length} مسدد`} />
        <Stat label="منه في رصيد الدائن الآن" value={plan.owed} hint="الأصل وتكلفة التمويل المستحقة" />
        <Stat label="رصيد حساب الدائن" value={plan.balance} hint={plan.otherOwed ? `جداول أخرى على الحساب: ${fmt(plan.otherOwed)}` : undefined} />
        <Stat
          label="الفرق مع الدفتر"
          value={plan.difference}
          tone={Math.abs(plan.difference) >= 0.005 ? "text-amber-700" : "text-green-700"}
          hint={Math.abs(plan.difference) < 0.005 ? "الجدول يطابق الحساب" : plan.difference < 0 ? "الدين أو جزء منه لم يُقيد في الحساب" : "في الحساب دين لا يغطيه جدول"}
        />
      </div>

      {plan.isLongTerm && (
        <Card title="الجزء المتداول (القروض طويلة الأجل)">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-gray-500">يستحق خلال 12 شهراً</p>
              <p className="text-lg font-semibold ltr-nums">{fmt(plan.within12)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">يستحق بعد 12 شهراً</p>
              <p className="text-lg font-semibold ltr-nums">{fmt(plan.after12)}</p>
            </div>
          </div>
          {canPay && plan.within12 > 0 && (
            <div className="mt-3">
              <DialogButton label="إعادة تصنيف الجزء المتداول" title="إعادة تصنيف الجزء المتداول">
                <ActionForm action={planAction.bind(null, plan.id)} resetOnSuccess={false} className="flex flex-col gap-3 text-sm">
                  <input type="hidden" name="op" value="reclass" />
                  <label className="flex flex-col gap-1">
                    <span className="font-medium text-gray-700">بتاريخ (عادةً آخر الشهر أو السنة)</span>
                    <Input type="date" name="date" defaultValue={monthEnd} required />
                  </label>
                  <div>
                    <span className="mb-1.5 block font-medium text-gray-700">إلى حساب القروض قصيرة الأجل</span>
                    <AccountField name="targetAccountId" options={await toAccountOptions(creditors)} defaultValue={current?.id} scope="2114" required />
                  </div>
                  <p className="text-xs text-gray-500">
                    قيد مدين {plan.code} دائن حساب القروض قصيرة الأجل بالأصل المستحق خلال 12 شهراً من التاريخ، ويُعكس تلقائياً في اليوم التالي فيبقى السداد على {plan.code}.
                  </p>
                  <SubmitButton>إنشاء القيد</SubmitButton>
                </ActionForm>
              </DialogButton>
            </div>
          )}
          {reclass.length > 0 && (
            <ActionForm action={planAction.bind(null, plan.id)} resetOnSuccess={false} className="mt-3 text-sm">
              <input type="hidden" name="op" value="" />
              <ul className="flex flex-col gap-1">
                {reclass
                  .filter((r) => r.type === "installment_reclass")
                  .map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2">
                      <Link href={`/journal?open=${r.id}`} className="text-brand-700 hover:underline ltr-nums">
                        {r.number}
                      </Link>
                      <span className="ltr-nums text-gray-600">{fmtDate(r.date)}</span>
                      {canPay && (
                        <ConfirmSubmit op={`undo_reclass:${r.date}`} title="حذف قيد إعادة التصنيف" text="يُحذف القيد وعكسه في اليوم التالي." submit="حذف" danger>
                          حذف
                        </ConfirmSubmit>
                      )}
                    </li>
                  ))}
              </ul>
            </ActionForm>
          )}
        </Card>
      )}

      <div className="mt-4">
        <Card title="الأقساط">
          <Table head={["#", "الاستحقاق", "الأصل", "تكلفة التمويل", "القسط", "المسدد", "الباقي", "الحالة", ""]}>
            {plan.items.map((i) => (
              <tr key={i.id} className={`border-t border-gray-100 ${i.state === "overdue" ? "bg-red-50/60" : ""}`}>
                <Td className="ltr-nums">{i.seq}</Td>
                <Td className={`ltr-nums ${i.state === "overdue" ? "font-semibold text-red-700" : ""}`}>{fmtDate(i.dueDate)}</Td>
                <Td className="ltr-nums">{fmt(i.principal)}</Td>
                <Td className="ltr-nums">
                  {fmt(i.cost)}
                  {i.costEntryId && (
                    <Link href={`/journal?open=${i.costEntryId}`} className="block text-xs text-brand-700 hover:underline">
                      قُيدت
                    </Link>
                  )}
                </Td>
                <Td className="ltr-nums font-medium">{fmt(i.total)}</Td>
                <Td className="ltr-nums">{fmt(i.paid)}</Td>
                <Td className="ltr-nums">{fmt(i.remaining)}</Td>
                <Td>
                  <InstallmentBadge state={i.state} partial={i.paid > 0} />
                </Td>
                <Td>
                  <div className="flex gap-1">
                    {active && canPay && i.remaining > 0 && <PayInstallmentButton id={i.id} planId={plan.id} title={`سداد القسط ${i.seq}`} remaining={i.remaining} today={today} from={from} />}
                    {active && canPay && i.paid === 0 && i.status === "open" && (
                      <DialogButton label="تعديل" title={`تعديل القسط ${i.seq}`}>
                        <ActionForm action={updateInstallmentAction.bind(null, i.id, plan.id)} resetOnSuccess={false} className="flex flex-col gap-3 text-sm">
                          <label className="flex flex-col gap-1">
                            <span className="font-medium text-gray-700">تاريخ الاستحقاق</span>
                            <Input type="date" name="dueDate" defaultValue={i.dueDate} required />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="font-medium text-gray-700">الأصل</span>
                            <Input name="principal" inputMode="decimal" defaultValue={i.principal.toFixed(2)} required />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="font-medium text-gray-700">تكلفة التمويل</span>
                            <Input name="cost" inputMode="decimal" defaultValue={i.cost.toFixed(2)} />
                          </label>
                          {i.costEntryId && <p className="text-xs text-gray-500">قيد تكلفة هذا القسط يُحذف ويُعاد بالمبلغ الجديد.</p>}
                          <SubmitButton>حفظ</SubmitButton>
                        </ActionForm>
                      </DialogButton>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="سندات السداد">
          <Table head={["السند", "التاريخ", "القسط", "المبلغ", "الحالة"]}>
            {payments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-sm text-gray-500">
                  لم يُسدد شيء بعد
                </td>
              </tr>
            )}
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <Td className="ltr-nums">{p.entryId ? <Link href={`/journal?open=${p.entryId}`} className="text-brand-700 hover:underline">{p.number}</Link> : p.number}</Td>
                <Td className="ltr-nums">{fmtDate(p.date)}</Td>
                <Td>{p.payoff ? "سداد مبكر" : `القسط ${p.seq}`}</Td>
                <Td className="ltr-nums">{fmt(p.amount)}</Td>
                <Td>{p.status === "posted" ? <Badge tone="green">مرحّل</Badge> : <Badge>مسودة</Badge>}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-gray-500">
            سند القسط العادي يُرجع من{" "}
            <Link href="/payments" className="text-brand-700 underline">
              سندات الصرف
            </Link>{" "}
            فيعود القسط مستحقاً.
          </p>
        </Card>
      </div>

      {canPay && (plan.payoffPaymentId || (canDelete && !plan.hasPayments)) && (
        <ActionForm action={planAction.bind(null, plan.id)} resetOnSuccess={false} className="mt-4 flex flex-wrap gap-2">
          <input type="hidden" name="op" value="" />
          {plan.payoffPaymentId && (
            <ConfirmSubmit op="undo_payoff" title="إلغاء السداد المبكر" text="يُحذف سند السداد المبكر وقيد الفرق، وتعود الأقساط الباقية مستحقة." submit="إلغاء السداد المبكر" danger>
              إلغاء السداد المبكر
            </ConfirmSubmit>
          )}
          {canDelete && !plan.hasPayments && (
            <ConfirmSubmit
              op="delete"
              title="حذف جدول الأقساط"
              text="يُحذف الجدول وأقساطه، وقيود تكلفة التمويل المستحقة عليه. الدين نفسه يبقى في حساب الدائن."
              submit="حذف"
              danger
              fields={<Input name="reason" placeholder="سبب الحذف" required />}
            >
              حذف الجدول
            </ConfirmSubmit>
          )}
        </ActionForm>
      )}
    </>
  );
}
