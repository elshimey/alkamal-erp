"use client";

// قائمة الشحنات مع التحديد والإجراءات الجماعية (ورقة المراجعة): تسليم المحدد واعتماده دفعة واحدة.

import Link from "next/link";
import { useState, useTransition } from "react";
import { Truck } from "@/components/icons";
import { Badge } from "@/components/ui";
import { WAYBILL_STATUS, type WaybillStatus } from "@/data/waybills";

export interface WaybillRow {
  id: number;
  number: string;
  date: string;
  customer: string;
  route: string;
  executor: string;
  driver: string;
  amount: number | null;
  status: WaybillStatus;
  rejectionReason: string | null;
}

export function WaybillTable({
  rows,
  showPrices,
  canDeliver,
  canApprove,
  canOverride,
  action,
}: {
  rows: WaybillRow[];
  showPrices: boolean;
  canDeliver: boolean;
  canApprove: boolean;
  canOverride: boolean;
  action: (kind: "deliver" | "approve", ids: number[], overrideReason?: string) => Promise<{ done: number; errors: Record<number, string> }>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok?: string; errors?: Record<number, string> }>({});
  const [pending, start] = useTransition();
  const selectable = rows.filter((r) => ["draft", "in_transit", "delivered"].includes(r.status));
  const allOn = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const run = (kind: "deliver" | "approve") =>
    start(async () => {
      const res = await action(kind, [...selected], reason || undefined);
      setSelected(new Set(Object.keys(res.errors).map(Number)));
      setResult({
        ok: res.done ? `${kind === "approve" ? "اعتُمدت" : "سُلِّمت"} الشحنات: ${res.done}` : undefined,
        errors: Object.keys(res.errors).length ? res.errors : undefined,
      });
    });
  const numberOf = (id: number) => rows.find((r) => r.id === id)?.number ?? id;
  const cols = 8 + (showPrices ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      {(canDeliver || canApprove) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">المحدد: {selected.size}</span>
          {canDeliver && (
            <button type="button" disabled={!selected.size || pending} onClick={() => run("deliver")} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50">
              تسليم المحدد
            </button>
          )}
          {canApprove && (
            <button type="button" disabled={!selected.size || pending} onClick={() => run("approve")} className="rounded-lg bg-brand-600 px-4 py-1.5 font-semibold text-brand-900 shadow-sm hover:bg-brand-500 disabled:opacity-50">
              {pending ? (
                <span className="flex items-center gap-2">
                  <Truck className="w-7" spinning />
                  جارٍ التنفيذ…
                </span>
              ) : (
                "اعتماد المحدد"
              )}
            </button>
          )}
          {canApprove && canOverride && (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="سبب تجاوز الضوابط (عند الحاجة)"
              className="min-w-56 rounded-lg border border-gray-300 bg-white px-3 py-1.5 outline-none focus:border-brand-600"
            />
          )}
        </div>
      )}
      {result.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{result.ok}</p>}
      {result.errors && (
        <ul className="list-inside list-disc rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {Object.entries(result.errors).map(([id, e]) => (
            <li key={id}>
              {numberOf(Number(id))}: {e}
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)]">
        <table className="w-full text-sm">
          <thead className="bg-asphalt-900 text-white/85">
            <tr>
              <th className="w-10 px-3 py-3">
                <input type="checkbox" aria-label="تحديد الكل" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(selectable.map((r) => r.id)))} className="accent-brand-600" />
              </th>
              {["الرقم", "التاريخ", "العميل", "المسار", "المركبة / الناقل", "السائق", ...(showPrices ? ["المبلغ"] : []), "الحالة"].map((h) => (
                <th key={h} className="px-3 py-3 text-start font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-brand-50/60">
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols} className="px-4 py-10 text-center text-gray-400">
                  لا توجد شحنات في هذا التصنيف
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-brand-50" : ""}>
                <td className="px-3 py-2.5 text-center">
                  {selectable.includes(r) && <input type="checkbox" aria-label={`تحديد ${r.number}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="accent-brand-600" />}
                </td>
                <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                  <Link href={`/waybills/${r.id}`} className="ltr-nums text-brand-700 hover:underline">
                    {r.number}
                  </Link>
                </td>
                <td className="ltr-nums px-3 py-2.5">{r.date}</td>
                <td className="px-3 py-2.5">{r.customer}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.route}</td>
                <td className="px-3 py-2.5">{r.executor}</td>
                <td className="px-3 py-2.5">{r.driver}</td>
                {showPrices && <td className="ltr-nums px-3 py-2.5 font-medium">{r.amount?.toLocaleString("en", { minimumFractionDigits: 2 })}</td>}
                <td className="px-3 py-2.5" title={r.rejectionReason ?? undefined}>
                  <Badge tone={WAYBILL_STATUS[r.status].tone}>{WAYBILL_STATUS[r.status].label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
