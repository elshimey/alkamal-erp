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
  payer: "driver_custody" | "customs_broker" | "cash";
  partyId: string;
  cashAccountId: string;
  note: string;
}

export const PAYER_LABELS = { driver_custody: "عهدة السائق", customs_broker: "المخلص", cash: "صندوق / بنك الشركة" } as const;

const field = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";
const num = (v: string) => Number(v.replace(/[,\s]/g, "")) || 0;

export function newCharge(opts: { fleet: boolean; cashAccounts: QuickOption[]; waybillId?: string }): ChargeDraft {
  return {
    waybillId: opts.waybillId ?? "",
    chargeTypeId: "",
    amount: "",
    payer: opts.fleet ? "driver_custody" : "cash",
    partyId: "",
    cashAccountId: opts.fleet ? "" : (opts.cashAccounts[0]?.value ?? ""),
    note: "",
  };
}

/** صفوف «مصاريف على العميل» داخل نافذة الشحنة ومسودة الفاتورة. */
export function CustomerChargesEditor({
  rows,
  onChange,
  chargeTypes,
  brokers,
  cashAccounts,
  waybills,
  fleet,
}: {
  rows: ChargeDraft[];
  onChange: (rows: ChargeDraft[]) => void;
  chargeTypes: QuickOption[];
  brokers: QuickOption[];
  cashAccounts: QuickOption[];
  /** قائمة الشحنات (في الفاتورة فقط) */
  waybills?: (QuickOption & { fleet: boolean })[];
  /** شحنة أسطول: عهدة السائق متاحة */
  fleet: boolean;
}) {
  const set = (i: number, patch: Partial<ChargeDraft>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const fleetOf = (r: ChargeDraft) => (waybills ? (waybills.find((w) => w.value === r.waybillId)?.fleet ?? false) : fleet);
  const total = rows.reduce((a, r) => a + num(r.amount), 0);
  const add = () => {
    const w = waybills?.length === 1 ? waybills[0] : undefined;
    onChange([...rows, newCharge({ fleet: waybills ? !!w?.fleet : fleet, cashAccounts, waybillId: w?.value })]);
  };

  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const payers = (fleetOf(r) ? (["driver_custody", "cash", "customs_broker"] as const) : (["cash", "customs_broker"] as const)).map((p) => ({ value: p, label: PAYER_LABELS[p] }));
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
                  set(i, { waybillId: e.target.value, ...(w && !w.fleet && r.payer === "driver_custody" ? { payer: "cash", cashAccountId: r.cashAccountId || (cashAccounts[0]?.value ?? "") } : {}) });
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
              <ComboBox value={r.chargeTypeId} options={chargeTypes} allowEmpty={false} placeholder="النوع: رسوم جمركية، ميناء…" onChange={(v) => set(i, { chargeTypeId: v })} className={field} />
              <input value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} inputMode="decimal" placeholder="المبلغ" aria-label="المبلغ" className={`${field} ltr-nums`} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="من دفع"
                value={r.payer}
                onChange={(e) => {
                  const payer = e.target.value as ChargeDraft["payer"];
                  set(i, { payer, cashAccountId: payer === "cash" ? r.cashAccountId || (cashAccounts[0]?.value ?? "") : r.cashAccountId });
                }}
                className={field}
              >
                {payers.map((p) => (
                  <option key={p.value} value={p.value}>
                    دفعه: {p.label}
                  </option>
                ))}
              </select>
              {r.payer === "cash" && <ComboBox value={r.cashAccountId} options={cashAccounts} allowEmpty={false} placeholder="الصندوق أو البنك" onChange={(v) => set(i, { cashAccountId: v })} className={field} />}
              {r.payer === "customs_broker" && <ComboBox value={r.partyId} options={brokers} create="customs_broker" allowEmpty={false} placeholder="المخلص" onChange={(v) => set(i, { partyId: v })} className={field} />}
              {r.payer === "driver_custody" && <span className="self-center text-xs text-gray-500">يُخصم من عهدة سائق الرحلة</span>}
            </div>
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
