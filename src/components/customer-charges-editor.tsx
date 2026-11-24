"use client";

import { ComboBox } from "@/components/combo-box";
import { Icon } from "@/components/icons";
import { Segmented } from "@/components/panel-ui";
import { fmt } from "@/lib/format";
import type { QuickOption } from "@/lib/quick-add-types";

/**
 * مصروف على الشحنة أو الفاتورة. «على العميل»: يُقيد على 1114 ويُفوتر عليه سطراً مستقلاً ولا يمس ربح الرحلة.
 * «على الشركة»: تكلفة على الرحلة ومركبتها لا تظهر للعميل. وفي الحالتين «دُفعت» (من حساب أو المخلص) أو «لم تُدفع بعد».
 */
export interface ChargeDraft {
  /** في مسودة الفاتورة: أي شحنة فيها */
  waybillId: string;
  chargeTypeId: string;
  amount: string;
  /** على من: العميل (يُفوتر) أو الشركة (تكلفة الرحلة) */
  billTo: "customer" | "company";
  payer: "driver_custody" | "customs_broker" | "cash" | "unpaid";
  /** المخلص، أو المستفيد في «لم يُدفع بعد» */
  partyId: string;
  cashAccountId: string;
  note: string;
  /** مفتاح الصف في الشاشة فقط (لحركة دخول البند الجديد) */
  uid?: number;
}

export interface TripExpense {
  id: number;
  number: string;
  label: string;
  amount: string;
  status: "pending" | "approved";
  payer: string;
  waybill?: string;
}

export const PAYER_LABELS = { driver_custody: "عهدة السائق", customs_broker: "المخلص", cash: "الشركة", unpaid: "لم يُدفع بعد" } as const;

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";
const num = (v: string) => Number(v.replace(/[,\s]/g, "")) || 0;

let uid = 0;
export function newCharge(opts: { fleet: boolean; cashAccounts: QuickOption[]; waybillId?: string }): ChargeDraft {
  return {
    waybillId: opts.waybillId ?? "",
    chargeTypeId: "",
    amount: "",
    billTo: "customer",
    // ما دفعه السائق من عهدته يأتي من إيصاله (القائمة أعلاه) لا يُكتب يدوياً، حتى لا يتكرر
    payer: "cash",
    partyId: "",
    cashAccountId: "",
    note: "",
    uid: ++uid,
  };
}

const EFFECT: Record<string, [string, string]> = {
  "customer|paid": ["bg-brand-50 text-brand-700", "سطر مستقل في فاتورة العميل، ويُقيد على 1114 فلا يمس ربح الرحلة."],
  "customer|unpaid": ["bg-amber-50 text-amber-800", "يُعتمد ويُسدد من «سندات صرف تحت المراجعة»، والفاتورة لا تصدر قبل اعتماده."],
  "company|paid": ["bg-gray-100 text-gray-700", "تكلفة على الرحلة ومركبتها، لا تظهر للعميل ولا تدخل الفاتورة."],
  "company|unpaid": ["bg-amber-50 text-amber-800", "تكلفة على الرحلة، تُعتمد وتُسدد من «سندات صرف تحت المراجعة»."],
};

/** قسم «المصاريف» داخل نافذة الشحنة ومسودة الفاتورة والفاتورة المباشرة. */
export function CustomerChargesEditor({
  rows,
  onChange,
  chargeTypes,
  brokers,
  payees,
  cashAccounts,
  waybills,
  fleet,
  tripExpenses,
  picked,
  onPick,
  companyHint,
}: {
  rows: ChargeDraft[];
  onChange: (rows: ChargeDraft[]) => void;
  chargeTypes: QuickOption[];
  brokers: QuickOption[];
  /** المستفيد في «لم يُدفع بعد»: مورد أو ورشة أو مخلص… (اختياري؛ الفارغ يُقيد على 2106) */
  payees?: QuickOption[];
  cashAccounts: QuickOption[];
  /** قائمة الشحنات (في الفاتورة فقط) */
  waybills?: (QuickOption & { fleet: boolean })[];
  /** شحنة أسطول */
  fleet: boolean;
  /** إيصالات السائق والمصروفات المسجلة للرحلة: تُحمَّل على العميل برقمها بدل إعادة كتابتها */
  tripExpenses?: TripExpense[];
  picked?: number[];
  onPick?: (ids: number[]) => void;
  /** تنبيه تحت «على الشركة» حين لا توجد شحنة (الفاتورة المباشرة: تُحمَّل على رحلتها) */
  companyHint?: string;
}) {
  const set = (i: number, patch: Partial<ChargeDraft>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const cust = rows.filter((r) => r.billTo !== "company").reduce((a, r) => a + num(r.amount), 0);
  const comp = rows.filter((r) => r.billTo === "company").reduce((a, r) => a + num(r.amount), 0);
  const add = () => {
    const w = waybills?.length === 1 ? waybills[0] : undefined;
    onChange([...rows, newCharge({ fleet: waybills ? !!w?.fleet : fleet, cashAccounts, waybillId: w?.value })]);
  };

  return (
    <div className="space-y-3">
      {!!tripExpenses?.length && (
        <div className="space-y-1 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
          <span className="block text-xs font-medium text-sky-900">مصروفات مسجلة لهذه الرحلة (من تطبيق السائق أو المصروفات)</span>
          <span className="block text-[11px] text-sky-800">علّم ما يُحمَّل على العميل؛ يبقى مخصوماً من العهدة مرة واحدة ويُفوتر مرة واحدة.</span>
          {tripExpenses.map((x) => (
            <label key={x.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-sky-100/60">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={picked?.includes(x.id) ?? false}
                onChange={(e) => onPick?.(e.target.checked ? [...(picked ?? []), x.id] : (picked ?? []).filter((id) => id !== x.id))}
              />
              <span className="min-w-0 flex-1">
                <span className="ltr-nums text-gray-500">{x.number}</span> {x.label}
                <span className="block text-[11px] text-gray-500">
                  {x.waybill ? `${x.waybill} · ` : ""}
                  {x.payer} · {x.status === "pending" ? "بانتظار الاعتماد: يدخل الفاتورة عند اعتماده" : "معتمد"}
                </span>
              </span>
              <span className="ltr-nums font-medium">{fmt(x.amount)}</span>
            </label>
          ))}
        </div>
      )}
      {rows.map((r, i) => {
        const billTo = r.billTo ?? "customer";
        const paid = r.payer === "unpaid" ? "unpaid" : "paid";
        const [effCls, effTxt] = EFFECT[`${billTo}|${paid}`];
        return (
          <div
            key={r.uid ?? i}
            className={`line-in space-y-2.5 rounded-xl border p-3 transition-colors duration-300 ${billTo === "company" ? "border-dashed border-gray-300 bg-white" : "border-brand-100 bg-brand-50/40"}`}
          >
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="grid size-5 place-items-center rounded-md bg-asphalt-900 text-[10px] font-bold text-brand-500">{i + 1}</span>
              مصروف
              <button type="button" aria-label="حذف المصروف" onClick={() => onChange(rows.filter((_, k) => k !== i))} className="ms-auto rounded-lg p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600">
                <Icon name="close" className="size-4" />
              </button>
            </div>
            {waybills && (
              <select
                aria-label="الشحنة"
                value={r.waybillId}
                onChange={(e) => {
                  const w = waybills.find((x) => x.value === e.target.value);
                  set(i, { waybillId: e.target.value, ...(w && !w.fleet && r.payer === "driver_custody" ? { payer: "cash" } : {}) });
                }}
                className={field}
              >
                <option value="">اختر الشحنة…</option>
                {waybills.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
              <ComboBox value={r.chargeTypeId} options={chargeTypes} create="charge_type" allowEmpty={false} placeholder="النوع: تخليص، رسوم ميناء، مبيت…" onChange={(v) => set(i, { chargeTypeId: v })} className={field} />
              <input value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} inputMode="decimal" placeholder="المبلغ" aria-label="المبلغ" className={`${field} ltr-nums`} />
            </div>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <span className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">على من؟</span>
                <Segmented
                  label="على من"
                  value={billTo}
                  options={[
                    { value: "customer", label: "العميل" },
                    { value: "company", label: "الشركة" },
                  ]}
                  tone={(v) => (v === "customer" ? "brand" : "plain")}
                  onChange={(v) => set(i, { billTo: v })}
                />
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-500">الدفع</span>
                <Segmented
                  label="الدفع"
                  value={paid}
                  options={[
                    { value: "paid", label: "دُفعت" },
                    { value: "unpaid", label: "لم تُدفع بعد" },
                  ]}
                  tone={(v) => (v === "unpaid" ? "amber" : "green")}
                  onChange={(v) => set(i, { payer: v === "unpaid" ? "unpaid" : "cash", partyId: "" })}
                />
              </span>
              {paid === "paid" && (
                <span className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-gray-500">دفعها</span>
                  <Segmented
                    label="من دفع"
                    value={r.payer === "customs_broker" ? "customs_broker" : "cash"}
                    options={[
                      { value: "cash", label: "الشركة" },
                      { value: "customs_broker", label: "المخلص" },
                    ]}
                    onChange={(v) => set(i, { payer: v, partyId: "" })}
                  />
                </span>
              )}
            </div>
            {r.payer === "cash" && (
              <ComboBox value={r.cashAccountId} options={cashAccounts} create="account" scope="1101,1102" allowEmpty={false} placeholder="دُفعت من أي حساب؟ صندوق، بنك، عهدة…" onChange={(v) => set(i, { cashAccountId: v })} className={field} />
            )}
            {r.payer === "customs_broker" && <ComboBox value={r.partyId} options={brokers} create="customs_broker" allowEmpty={false} placeholder="المخلص" onChange={(v) => set(i, { partyId: v })} className={field} />}
            {r.payer === "unpaid" && <ComboBox value={r.partyId} options={payees ?? brokers} create="supplier" placeholder="المستفيد (اختياري)" onChange={(v) => set(i, { partyId: v })} className={field} />}
            <p className={`rounded-lg px-2.5 py-1.5 text-[11.5px] transition-colors duration-300 ${effCls}`}>
              {effTxt}
              {billTo === "company" && companyHint ? ` ${companyHint}` : ""}
            </p>
            <input value={r.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="ملاحظة (رقم الإيصال مثلاً)" aria-label="ملاحظة" className={field} />
          </div>
        );
      })}
      <button type="button" onClick={add} className="flex w-full items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-gray-300 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:border-brand-600 hover:bg-brand-50 hover:text-brand-700">
        + إضافة مصروف
      </button>
      {rows.length > 0 && (
        <span className="flex flex-wrap gap-x-4 text-xs text-gray-500">
          <span>
            على العميل <b className="ltr-nums text-gray-800">{fmt(cust)}</b>
          </span>
          <span>
            على الشركة <b className="ltr-nums text-gray-800">{fmt(comp)}</b>
          </span>
        </span>
      )}
    </div>
  );
}
