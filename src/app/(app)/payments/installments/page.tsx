import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { toAccountOptions } from "@/lib/lookups";
import { dueInstallments, installmentPayFrom, installmentPlans } from "@/lib/installments";
import { todayRiyadh } from "@/lib/dates";
import { AddMenu } from "@/components/add-menu";
import { Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { fmt, fmtDate } from "@/lib/format";
import { InstallmentBadge, PayInstallmentButton, type PayFrom } from "./pay-forms";
import { PlanPanel } from "./plan-panel";

/**
 * «الأقساط» (ملاحظة التشغيل 16): أقساط هذا الشهر ومجموعها، والمتأخرة بالأحمر، وزر «سداد» لكل قسط،
 * وتحتها جداول الأقساط بالباقي والقسط القادم والفرق مع رصيد حساب الدائن.
 */
export default async function InstallmentsPage({ searchParams }: { searchParams: Promise<{ new?: string; paste?: string }> }) {
  const user = await requirePermission("payments", "view");
  const sp = await searchParams;
  const canPay = can(user.perms, "payments", "create");
  const today = todayRiyadh();
  const [due, plans, payFrom] = await Promise.all([dueInstallments(db, today), installmentPlans(db, today), installmentPayFrom(db)]);
  const from: PayFrom = {
    suggested: await toAccountOptions(payFrom.suggested),
    all: await toAccountOptions(payFrom.all),
    first: String(payFrom.suggested.find((a) => a.code.startsWith("1102"))?.id ?? payFrom.suggested[0]?.id ?? ""),
  };
  const overdue = due.filter((d) => d.state === "overdue");
  const sum = (rows: typeof due) => rows.reduce((t, r) => t + r.remaining, 0);
  const active = plans.filter((p) => p.status === "active");

  return (
    <>
      <PageHeader title="الأقساط" description="جداول سداد الدائنين: القروض وأقساط المركبات والدائنون الشخصيون والموردون. القسط أصل يُخصم من حساب الدائن وتكلفة تمويل على 7101.">
        {canPay && (
          <AddMenu
            label="جدول أقساط"
            main={{ href: "/payments/installments?new=1", label: "جدول أقساط جديد" }}
            more={[{ href: "/payments/installments?new=1&paste=1", label: "لصق جدول البنك من Excel" }]}
          />
        )}
      </PageHeader>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-gray-500">أقساط هذا الشهر</p>
          <p className="mt-1 text-xl font-semibold ltr-nums" data-testid="month-total">
            {fmt(sum(due.filter((d) => d.state !== "overdue")))}
          </p>
          <p className="text-xs text-gray-500">{due.length - overdue.length} قسط</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500">متأخرة لم تُسدد</p>
          <p className={`mt-1 text-xl font-semibold ltr-nums ${overdue.length ? "text-red-700" : ""}`}>{fmt(sum(overdue))}</p>
          <p className="text-xs text-gray-500">{overdue.length} قسط</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500">الباقي في كل الجداول</p>
          <p className="mt-1 text-xl font-semibold ltr-nums">{fmt(active.reduce((t, p) => t + p.remaining, 0))}</p>
          <p className="text-xs text-gray-500">{active.length} جدول نشط</p>
        </Card>
      </div>

      <Card title="المستحق هذا الشهر والمتأخر">
        <Table head={["الاستحقاق", "الجدول", "الدائن", "القسط", "الأصل", "تكلفة التمويل", "المسدد", "الباقي", "الحالة", ""]}>
          {due.length === 0 && <EmptyRow cols={10}>لا أقساط مستحقة هذا الشهر</EmptyRow>}
          {due.map((d) => (
            <tr key={d.id} className={`border-t border-gray-100 ${d.state === "overdue" ? "bg-red-50/60" : ""}`}>
              <Td className={`ltr-nums ${d.state === "overdue" ? "font-semibold text-red-700" : ""}`}>{fmtDate(d.dueDate)}</Td>
              <Td>
                <Link href={`/payments/installments/${d.planId}`} className="text-brand-700 hover:underline">
                  {d.plan}
                </Link>
                <span className="block text-xs text-gray-500">القسط {d.seq}</span>
              </Td>
              <Td>
                {d.party ?? d.account}
                <span className="block text-xs text-gray-500 ltr-nums">{d.code}</span>
              </Td>
              <Td className="ltr-nums">{fmt(d.total)}</Td>
              <Td className="ltr-nums">{fmt(d.principal)}</Td>
              <Td className="ltr-nums">{fmt(d.cost)}</Td>
              <Td className="ltr-nums">{fmt(d.paid)}</Td>
              <Td className="ltr-nums font-medium">{fmt(d.remaining)}</Td>
              <Td>
                <InstallmentBadge state={d.state} partial={d.paid > 0} />
              </Td>
              <Td>{canPay && <PayInstallmentButton id={d.id} planId={d.planId} title={`سداد ${d.plan} – القسط ${d.seq}`} remaining={d.remaining} today={today} from={from} />}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mt-4">
        <Card title="جداول الأقساط">
          <Table head={["الجدول", "حساب الدائن", "المركبة", "الأقساط", "القسط القادم", "الباقي", "رصيد الحساب", "الفرق", "الحالة"]}>
            {plans.length === 0 && <EmptyRow cols={9}>لا توجد جداول أقساط بعد</EmptyRow>}
            {plans.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <Td>
                  <Link href={`/payments/installments/${p.id}`} className="font-medium text-brand-700 hover:underline">
                    {p.name}
                  </Link>
                  {p.party && <span className="block text-xs text-gray-500">{p.party}</span>}
                </Td>
                <Td>
                  {p.account} <span className="text-xs text-gray-500 ltr-nums">{p.code}</span>
                </Td>
                <Td>{p.vehicle ?? "—"}</Td>
                <Td className="ltr-nums">
                  {p.items.filter((i) => i.state === "paid").length} / {p.items.length}
                </Td>
                <Td className="ltr-nums">{p.next ? `${fmtDate(p.next.dueDate)} · ${fmt(p.next.remaining)}` : "—"}</Td>
                <Td className="ltr-nums font-medium">{fmt(p.remaining)}</Td>
                <Td className="ltr-nums">{fmt(p.balance)}</Td>
                <Td className={`ltr-nums ${Math.abs(p.difference) >= 0.005 ? "font-semibold text-amber-700" : "text-gray-500"}`}>{fmt(p.difference)}</Td>
                <Td>{p.status === "settled" ? <InstallmentBadge state="settled" /> : p.remaining < 0.005 ? <InstallmentBadge state="paid" /> : <InstallmentBadge state={p.next?.state ?? "upcoming"} />}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-gray-500">
            «الفرق» = رصيد حساب الدائن ناقص ما بقي من الأقساط فيه (الأصل وتكلفة التمويل المستحقة). الصفر يعني أن الجدول يطابق الدفتر؛ غيره يعني ديناً لم يُقيد في الحساب أو جدولاً آخر عليه.
          </p>
        </Card>
      </div>

      {sp.new === "1" && canPay && <PlanPanel closeHref="/payments/installments" paste={sp.paste === "1"} />}
    </>
  );
}
