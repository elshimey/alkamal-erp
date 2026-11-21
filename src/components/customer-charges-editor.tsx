"use client";

import { ComboBox } from "@/components/combo-box";
import { Icon } from "@/components/icons";
import { fmt } from "@/lib/format";
import type { QuickOption } from "@/lib/quick-add-types";

/** مصروف يدفعه المكتب عن العميل (جمارك، رسوم ميناء…) ويُفوتر عليه: يُقيد على 1114 ولا يمس ربح الرحلة. */
export interface ChargeDraft {
  /** في مسودة الفاتورة: أي شحنة فيها */
  waybillId: string;
  chargeTypeId: string;
  amount: string;
  payer: "driver_custody" | "customs_broker" | "cash" | "unpaid";
  /** المخلص، أو المستفيد في «لم يُدفع بعد» */
  partyId: string;
  cashAccountId: string;
  note: string;
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

export function newCharge(opts: { fleet: boolean; cashAccounts: QuickOption[]; waybillId?: string }): ChargeDraft {
  return {
    waybillId: opts.waybillId ?? "",
    chargeTypeId: "",
    amount: "",
    // ما دفعه السائق من عهدته يأتي من إيصاله (القائمة أعلاه) لا يُكتب يدوياً، حتى لا يتكرر
    payer: "cash",
    partyId: "",
    cashAccountId: "",
    note: "",
  };
}

/** صفوف «مصاريف على العميل» داخل نافذة الشحنة ومسودة الفاتورة. */
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
}) {
  const set = (i: number, patch: Partial<ChargeDraft>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((a, r) => a + num(r.amount), 0);
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
        const payers = (["cash", "customs_broker", "unpaid"] as const).map((p) => ({ value: p, label: PAYER_LABELS[p] }));
        return (
          <div key={i} className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
            <div className="flex items-center justify-between text-xs text-amber-800">
              <span>مصروف {i + 1} على العميل</span>
              <button type="button" aria-label="حذف المصروف" onClick={() => onChange(rows.filter((_, k) => k !== i))} className="p-1 text-gray-400 hover:text-red-600">
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
              <ComboBox value={r.chargeTypeId} options={chargeTypes} create="charge_type" allowEmpty={false} placeholder="النوع: رسوم جمركية، ميناء…" onChange={(v) => set(i, { chargeTypeId: v })} className={field} />
              <input value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} inputMode="decimal" placeholder="المبلغ" aria-label="المبلغ" className={`${field} ltr-nums`} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="من دفع"
                value={r.payer}
                onChange={(e) => {
                  const payer = e.target.value as ChargeDraft["payer"];
                  set(i, { payer, partyId: "" });
                }}
                className={field}
              >
                {payers.map((p) => (
                  <option key={p.value} value={p.value}>
                    دفعه: {p.label}
                  </option>
                ))}
              </select>
              {r.payer === "cash" && (
                <ComboBox value={r.cashAccountId} options={cashAccounts} create="account" scope="1101,1102" allowEmpty={false} placeholder="من أي حساب؟ صندوق، بنك…" onChange={(v) => set(i, { cashAccountId: v })} className={field} />
              )}
              {r.payer === "unpaid" && (
                <ComboBox value={r.partyId} options={payees ?? brokers} create="supplier" placeholder="المستفيد (اختياري)" onChange={(v) => set(i, { partyId: v })} className={field} />
              )}
              {r.payer === "customs_broker" && <ComboBox value={r.partyId} options={brokers} create="customs_broker" allowEmpty={false} placeholder="المخلص" onChange={(v) => set(i, { partyId: v })} className={field} />}
            </div>
            {r.payer === "unpaid" && (
              <span className="block text-[11px] text-amber-800">يُعتمد ويُسدد من «سندات صرف تحت المراجعة»، والفاتورة لا تصدر قبل اعتماده.</span>
            )}
            <input value={r.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="ملاحظة (رقم الإيصال مثلاً)" aria-label="ملاحظة" className={field} />
          </div>
        );
      })}
      <button type="button" onClick={add} className="text-xs text-brand-700 hover:underline">
        + مصروف على العميل (جمارك، رسوم ميناء، تخليص…)
      </button>
      {rows.length > 0 && (
        <span className="block text-xs text-gray-500">
          الإجمالي <b className="ltr-nums">{fmt(total)}</b>. يظهر كل مصروف سطراً مستقلاً في فاتورة العميل، ويُقيد على 1114 فلا يمس ربح الرحلة.
        </span>
      )}
    </div>
  );
}
