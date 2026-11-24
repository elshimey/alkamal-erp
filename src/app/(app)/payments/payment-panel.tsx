import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { driverOptions, payFromTree, toAccountOptions } from "@/lib/lookups";
import { payFromAccounts } from "@/lib/invoices";
import { supplierOptions } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { fmt } from "@/lib/format";
import { PAYMENT_KINDS } from "@/data/purchases";
import { PAYMENT_METHODS } from "@/data/sales";
import { AccountField } from "@/components/account-field";
import { FormCombo } from "@/components/form-combo";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { Input, Select } from "@/components/ui";
import { savePaymentPanel } from "./actions";

const radio = "flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50";

/**
 * نافذة سند صرف واحد (جديد أو تعديل، طلب أحمد 2026-11-24): لمن (مورد أو عهدة سائق)، المبلغ ومن أي حساب،
 * وعلى أي فاتورة مورد. المرحّل يُعاد ترحيله عند الحفظ. سند سداد القسط أو المصروف المستحق يُعدَّل
 * تاريخه وحسابه وطريقته ومرجعه فقط لأن مبلغه وجهته مربوطان بما سدده.
 */
export async function PaymentPanel({ closeHref, canPost, payment }: { closeHref: string; canPost: boolean; payment?: typeof s.payments.$inferSelect | null }) {
  const p = payment ?? null;
  const allocated = p ? await db.select({ invoiceId: s.paymentAllocations.invoiceId }).from(s.paymentAllocations).where(eq(s.paymentAllocations.paymentId, p.id)) : [];
  const currentInvoice = allocated.length === 1 ? allocated[0].invoiceId : null;
  const [suppliers, drivers, cashes, tree, invoices] = await Promise.all([
    supplierOptions(db),
    driverOptions(),
    payFromAccounts(db),
    payFromTree(),
    db
      .select({ id: s.purchaseInvoices.id, number: s.purchaseInvoices.number, supplier: s.parties.nameAr, total: s.purchaseInvoices.total, paid: s.purchaseInvoices.paidAmount })
      .from(s.purchaseInvoices)
      .innerJoin(s.parties, eq(s.parties.id, s.purchaseInvoices.supplierId))
      .where(
        and(
          eq(s.purchaseInvoices.status, "posted"),
          // فاتورة السند المعدَّل تظهر ولو سددها هو نفسه
          currentInvoice ? or(sql`${s.purchaseInvoices.paidAmount} < ${s.purchaseInvoices.total}`, eq(s.purchaseInvoices.id, currentInvoice)) : sql`${s.purchaseInvoices.paidAmount} < ${s.purchaseInvoices.total}`,
        ),
      )
      .orderBy(s.purchaseInvoices.dueDate),
  ]);
  const cashOpts = await toAccountOptions(cashes);
  const firstCash = cashes.find((a) => a.code.startsWith("1101")) ?? cashes[0];
  const locked = p?.kind === "expense" || p?.kind === "installment";
  const kind = p?.kind ?? "supplier";
  const val = (v: string | number | null | undefined) => (v == null ? "" : String(v));
  return (
    <RecordPanel
      key={p ? `edit-${p.id}` : "new"}
      title={p ? `تعديل سند الصرف ${p.number}` : "سند صرف جديد"}
      subtitle={
        p
          ? p.status === "posted"
            ? "مرحّل: «حفظ» يلغي قيده ويرحّل قيداً جديداً ويعيد تخصيصه على الفواتير"
            : "مسودة"
          : canPost
            ? "«حفظ» مسودة، و«حفظ وترحيل» يرحّل القيد فوراً"
            : "يُحفظ مسودة حتى يرحّله المحاسب"
      }
      closeHref={closeHref}
      action={savePaymentPanel.bind(null, p?.id ?? null)}
      creating={!p}
      altSubmit={!p && canPost ? { label: "حفظ وترحيل", name: "post" } : undefined}
    >
      <PanelSection title="لمن">
        {locked ? (
          <>
            <input type="hidden" name="kind" value={kind} />
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
              {PAYMENT_KINDS[kind]}: المبلغ والجهة مربوطان بما سدده السند، فيُعدَّل التاريخ والحساب والطريقة والمرجع فقط.
            </p>
          </>
        ) : (
          <div className="group/kind flex flex-col gap-3">
            <span className="flex flex-wrap gap-2">
              <label className={radio}>
                <input id="pay-supplier" type="radio" name="kind" value="supplier" defaultChecked={kind === "supplier"} required className="accent-brand-600" />
                سداد لمورد أو ناقل
              </label>
              <label className={radio}>
                <input id="pay-custody" type="radio" name="kind" value="custody" defaultChecked={kind === "custody"} className="accent-brand-600" />
                صرف عهدة لسائق
              </label>
            </span>
            <div className="group-has-[#pay-supplier:checked]/kind:block hidden">
              <PanelField label="المورد / الناقل / الورشة">
                <FormCombo name="partyId" defaultValue={val(p?.partyId)} options={suppliers} create="supplier" placeholder="اكتب اسم الجهة…" />
              </PanelField>
            </div>
            <div className="group-has-[#pay-custody:checked]/kind:block hidden">
              <PanelField label="السائق">
                <FormCombo name="driverId" defaultValue={val(p?.driverId)} options={drivers} create="driver" placeholder="اكتب اسم السائق…" />
              </PanelField>
            </div>
          </div>
        )}
        <PanelField label="التاريخ" required>
          <Input type="date" name="date" defaultValue={p?.paymentDate ?? todayRiyadh()} required className="w-full" />
        </PanelField>
      </PanelSection>

      <PanelSection title="المبلغ والحساب">
        <PanelField label="المبلغ" required>
          <Input name="amount" type="number" min={0.01} step="0.01" required dir="ltr" defaultValue={val(p?.amount)} readOnly={locked} className="w-full" />
        </PanelField>
        <PanelField label="العملة">
          {locked ? (
            <Input name="currency" value={p!.currencyCode} readOnly dir="ltr" className="w-full" />
          ) : (
            <Select name="currency" defaultValue={p?.currencyCode ?? "SAR"} className="w-full">
              <option value="SAR">SAR</option>
              <option value="KWD">KWD</option>
            </Select>
          )}
        </PanelField>
        <PanelField label="يُسدد من" required hint="صندوق أو بنك أو عهدة موظف، أو «عرض كل الشجرة»">
          <AccountField name="cashAccountId" options={cashOpts} moreOptions={tree} defaultValue={p?.cashAccountId ?? firstCash?.id} scope="1101,1102,1105" required />
        </PanelField>
        <PanelField label="الطريقة" required>
          <Select name="method" defaultValue={p?.method ?? "transfer"} required className="w-full">
            {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </PanelField>
      </PanelSection>

      {!locked && (
        <PanelSection title="على أي فاتورة" optional open={!!currentInvoice}>
          <PanelField label="فاتورة المورد" hint="فارغ = يُخصص على أقدم فواتير المورد استحقاقاً، والباقي رصيد للجهة">
            <Select name="invoiceId" defaultValue={val(currentInvoice)} className="w-full">
              <option value="">الأقدم استحقاقاً</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} · {i.supplier} · متبقي {fmt(Number(i.total) - Number(i.paid))}
                </option>
              ))}
            </Select>
          </PanelField>
        </PanelSection>
      )}

      <PanelSection title="المرجع" optional open={!p || !!p.reference || !!p.notes}>
        <PanelField label="المرجع / رقم الشيك">
          <Input name="reference" dir="ltr" defaultValue={p?.reference ?? ""} className="w-full" />
        </PanelField>
        <PanelField label="ملاحظات">
          <Input name="notes" defaultValue={p?.notes ?? ""} className="w-full" />
        </PanelField>
      </PanelSection>
    </RecordPanel>
  );
}
