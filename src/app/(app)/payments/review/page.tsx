import Link from "next/link";
import { PaymentsTabs } from "../tabs";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { payFromAccounts } from "@/lib/invoices";
import { undisbursedCustody, unpaidCharges, unpaidExpenses } from "@/lib/unpaid";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CashAccountField } from "@/components/cash-account-field";
import { DialogButton } from "@/components/dialog-button";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { fmt } from "@/lib/format";
import { approveChargeAction, approveExpenseAction, disburseAction, payAction } from "./actions";

const TABS = {
  charges: "مصاريف على العميل",
  expenses: "المصروفات والصيانة",
  custody: "عهد لم تُصرف",
} as const;
type Tab = keyof typeof TABS;

/**
 * «سندات صرف تحت المراجعة»: ما سُجّل «لم يُدفع بعد» ينتظر الاعتماد (قيد التزام على المستفيد أو 2106)
 * ثم السداد بسند صرف، وعهد الرحلات المرسلة دون صرف. الفاتورة لا تصدر قبل اعتماد مصاريفها على العميل.
 */
export default async function PaymentsReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string; invoice?: string; back?: string }> }) {
  const user = await requirePermission("payments", "view");
  const sp = await searchParams;
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "charges";
  const invoiceId = Number(sp.invoice) || undefined;
  // الرجوع للفاتورة التي فُتحت منها الصفحة (رابط داخلي فقط)
  const back = sp.back?.startsWith("/") && !sp.back.startsWith("//") ? sp.back : undefined;
  const canApprove = can(user.perms, "expenses", "approve");
  const canPay = can(user.perms, "payments", "create");
  const [charges, expenses, custody, cashes] = await Promise.all([unpaidCharges(db, { invoiceId }), unpaidExpenses(db), undisbursedCustody(db), payFromAccounts(db)]);
  const counts: Record<Tab, number> = { charges: charges.length, expenses: expenses.length, custody: custody.length };
  const href = (t: Tab) => `/payments/review?tab=${t}${back ? `&back=${encodeURIComponent(back)}` : ""}`;
  const payField = <CashAccountField options={cashes} label="يُسدد من" />;
  const payButton = (kind: "charge" | "expense", id: number, title: string) => (
    <DialogButton label="سداد" title={title}>
      <ActionForm action={payAction.bind(null, kind, id)} resetOnSuccess={false} className="flex flex-col gap-3 text-sm">
        {payField}
        <p className="text-xs text-gray-500">يُنشأ سند صرف مرحّل: مدين الالتزام دائن الحساب المختار.</p>
        <SubmitButton>سداد</SubmitButton>
      </ActionForm>
    </DialogButton>
  );
  const status = (approved: boolean) => (approved ? <Badge tone="blue">معتمد، لم يُسدد</Badge> : <Badge tone="amber">بانتظار الاعتماد</Badge>);

  return (
    <>
      <PageHeader
        title="سندات صرف تحت المراجعة"
        description="ما سُجّل «لم يُدفع بعد»: يُعتمد فيُقيد التزاماً على المستفيد (أو المصروفات المستحقة 2106)، ثم يُسدد بسند صرف. وعهد الرحلات التي أُرسلت للسائق دون صرف."
      >
        {back && (
          <Link href={back} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
            ← العودة للفاتورة
          </Link>
        )}
      </PageHeader>
      <PaymentsTabs active="review" />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="الأقسام">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link
            key={t}
            href={href(t)}
            aria-current={t === tab ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${t === tab ? "border-brand-600 bg-brand-50 font-semibold text-brand-900" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            {TABS[t]} <span className="ltr-nums">({counts[t]})</span>
          </Link>
        ))}
      </nav>

      {tab === "charges" && (
        <Card>
          {invoiceId && (
            <p className="mb-3 text-sm text-gray-600">
              مصاريف فاتورة واحدة فقط.{" "}
              <Link href={href("charges")} className="text-brand-700 underline">
                عرض الكل
              </Link>
            </p>
          )}
          <Table head={["الشحنة / الفاتورة", "التاريخ", "العميل", "السائق والمركبة", "المسار", "البند", "المستفيد", "المبلغ", "الحالة", ""]}>
            {charges.length === 0 && <EmptyRow cols={10}>لا توجد مصاريف على العميل تنتظر الاعتماد أو السداد</EmptyRow>}
            {charges.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <Td>
                  {c.waybillId ? (
                    <Link href={`/waybills/${c.waybillId}`} className="text-brand-700 hover:underline">
                      {c.waybill}
                    </Link>
                  ) : null}
                  {c.invoiceId && (
                    <Link href={`/invoices/${c.invoiceId}`} className="block text-xs text-gray-500 hover:underline">
                      فاتورة {c.invoice}
                    </Link>
                  )}
                </Td>
                <Td className="ltr-nums">{c.date}</Td>
                <Td>{c.customer}</Td>
                <Td>
                  {c.driver ?? "—"}
                  {c.vehicle && <span className="block text-xs text-gray-500">{c.vehicle}</span>}
                </Td>
                <Td>{c.route ?? "—"}</Td>
                <Td>
                  {c.type}
                  {c.note && <span className="block text-xs text-gray-500">{c.note}</span>}
                </Td>
                <Td>{c.payee ?? <span className="text-gray-500">غير محدد (2106)</span>}</Td>
                <Td className="ltr-nums font-medium">
                  {fmt(c.amount)} {c.currencyCode !== "SAR" && c.currencyCode}
                </Td>
                <Td>{status(c.approved)}</Td>
                <Td>
                  {!c.approved && canApprove && (
                    <ActionForm action={approveChargeAction.bind(null, c.id)} resetOnSuccess={false}>
                      <SubmitButton variant="secondary">اعتماد</SubmitButton>
                    </ActionForm>
                  )}
                  {c.approved && canPay && payButton("charge", c.id, `سداد ${c.type} – ${c.waybill ?? c.invoice}`)}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {tab === "expenses" && (
        <Card>
          <Table head={["المصروف", "التاريخ", "البيان", "الحساب", "السائق والمركبة", "الشحنة", "المستفيد", "المبلغ", "الحالة", ""]}>
            {expenses.length === 0 && <EmptyRow cols={10}>لا توجد مصروفات «لم يُدفع بعد» تنتظر الاعتماد أو السداد</EmptyRow>}
            {expenses.map((e) => (
              <tr key={e.id} className="border-t border-gray-100">
                <Td className="ltr-nums">{e.number}</Td>
                <Td className="ltr-nums">{e.date}</Td>
                <Td>
                  {e.description}
                  {e.billToCustomer && <span className="block text-xs text-amber-700">على العميل</span>}
                </Td>
                <Td>
                  {e.account} <span className="ltr-nums text-xs text-gray-500">{e.accountCode}</span>
                </Td>
                <Td>
                  {e.driver ?? "—"}
                  {e.vehicle && <span className="block text-xs text-gray-500">{e.vehicle}</span>}
                </Td>
                <Td>
                  {e.waybillId ? (
                    <Link href={`/waybills/${e.waybillId}`} className="text-brand-700 hover:underline">
                      {e.waybill}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>{e.payee ?? <span className="text-gray-500">غير محدد (2106)</span>}</Td>
                <Td className="ltr-nums font-medium">
                  {fmt(e.total)} {e.currencyCode !== "SAR" && e.currencyCode}
                </Td>
                <Td>{status(e.approved)}</Td>
                <Td>
                  {!e.approved && canApprove && (
                    <ActionForm action={approveExpenseAction.bind(null, e.id)} resetOnSuccess={false}>
                      <SubmitButton variant="secondary">اعتماد</SubmitButton>
                    </ActionForm>
                  )}
                  {e.approved && canPay && payButton("expense", e.id, `سداد المصروف ${e.number}`)}
                </Td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-gray-500">
            شراء قطع الصيانة دون دفع يُسجل «آجلاً من مورد» في أمر الصيانة فيصبح ديناً عليه ويُسدد من{" "}
            <Link href="/payments" className="text-brand-700 underline">
              سندات الصرف
            </Link>
            ، والمخالفات تُقيد مستحقة على 2108 حتى تُسدد من صفحة المخالفات.
          </p>
        </Card>
      )}

      {tab === "custody" && (
        <Card>
          <Table head={["الشحنة", "التاريخ", "السائق", "المركبة", "المسار", "عهدة الرحلة", ""]}>
            {custody.length === 0 && <EmptyRow cols={7}>كل عهد الرحلات المرسلة صُرفت</EmptyRow>}
            {custody.map((w) => (
              <tr key={w.id} className="border-t border-gray-100">
                <Td>
                  <Link href={`/waybills/${w.id}`} className="text-brand-700 hover:underline">
                    {w.number}
                  </Link>
                </Td>
                <Td className="ltr-nums">{w.date}</Td>
                <Td>{w.driver ?? "—"}</Td>
                <Td>{w.vehicle ?? "—"}</Td>
                <Td>{w.route ?? "—"}</Td>
                <Td className="ltr-nums font-medium">{fmt(w.custody)}</Td>
                <Td>
                  {canPay && (
                    <DialogButton label="صرف" title={`صرف عهدة الرحلة ${w.number}`}>
                      <ActionForm action={disburseAction.bind(null, w.id)} resetOnSuccess={false} className="flex flex-col gap-3 text-sm">
                        <CashAccountField options={cashes} label="تُصرف من" />
                        <p className="text-xs text-gray-500">يُنشأ سند عهدة مرحّل على السائق: مدين عهدته دائن الحساب المختار.</p>
                        <SubmitButton>صرف</SubmitButton>
                      </ActionForm>
                    </DialogButton>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
