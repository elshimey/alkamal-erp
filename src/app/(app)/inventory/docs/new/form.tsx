"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, Input, Select } from "@/components/ui";
import type { StockDocKind } from "@/data/inventory";
import { saveStockDoc } from "../../actions";

type Product = { id: number; label: string; unit: string; avg: number };
type Line = { productId: string; quantity: string; unitCost: string };
const empty = (): Line => ({ productId: "", quantity: "", unitCost: "" });
const fmt = (v: number) => v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = "w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none";

export function StockDocForm(props: {
  kind: StockDocKind;
  today: string;
  defaultWarehouse?: number;
  canPost: boolean;
  products: Product[];
  warehouses: { id: number; nameAr: string }[];
  balances: { p: number; w: number; q: number }[];
  accounts: { id: number; label: string; code: string }[];
  centers: { id: number; nameAr: string }[];
}) {
  const { kind } = props;
  const router = useRouter();
  const [date, setDate] = useState(props.today);
  const [warehouseId, setWarehouseId] = useState(String(props.defaultWarehouse ?? ""));
  const [toWarehouseId, setTo] = useState(String(props.warehouses.find((w) => w.id !== props.defaultWarehouse)?.id ?? ""));
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [offset, setOffset] = useState(String(props.accounts.find((a) => a.code === "6113")?.id ?? ""));
  const [costCenterId, setCostCenter] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([empty(), empty(), empty()]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const product = (id: string) => props.products.find((p) => String(p.id) === id);
  const have = (pid: string, wid: string) => props.balances.find((b) => String(b.p) === pid && String(b.w) === wid)?.q ?? 0;
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const filled = lines.filter((l) => l.productId && Number(l.quantity) > 0);
  const total = filled.reduce((t, l) => t + Number(l.quantity) * (direction === "in" && l.unitCost ? Number(l.unitCost) : (product(l.productId)?.avg ?? 0)), 0);

  const submit = (post: boolean) =>
    start(async () => {
      setError("");
      const r = await saveStockDoc({
        kind,
        docDate: date,
        warehouseId: Number(warehouseId),
        toWarehouseId: kind === "transfer" ? Number(toWarehouseId) : null,
        offsetAccountId: kind === "adjustment" && offset ? Number(offset) : null,
        costCenterId: costCenterId ? Number(costCenterId) : null,
        reason,
        lines:
          kind === "count"
            ? []
            : filled.map((l) => ({
                productId: Number(l.productId),
                quantity: kind === "adjustment" && direction === "out" ? -Number(l.quantity) : Number(l.quantity),
                unitCost: kind === "adjustment" && direction === "in" && l.unitCost ? Number(l.unitCost) : null,
              })),
        post,
      });
      if (r.error) setError(r.error);
      else router.push(`/inventory/docs?open=${r.id}`);
    });

  return (
    <div className="space-y-5">
      <section className="grid gap-4 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <Field label="التاريخ">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={kind === "transfer" ? "من المستودع" : "المستودع"}>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {props.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.nameAr}
              </option>
            ))}
          </Select>
        </Field>
        {kind === "transfer" && (
          <Field label="إلى المستودع">
            <Select value={toWarehouseId} onChange={(e) => setTo(e.target.value)}>
              <option value="">اختر</option>
              {props.warehouses
                .filter((w) => String(w.id) !== warehouseId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.nameAr}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {kind === "adjustment" && (
          <>
            <Field label="نوع التسوية">
              <Select value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")}>
                <option value="out">نقص (تالف، فقد، استهلاك)</option>
                <option value="in">زيادة (رصيد افتتاحي، وُجد زائداً)</option>
              </Select>
            </Field>
            <Field label="الحساب المقابل" hint="الرصيد الافتتاحي: 3103 الأرباح المبقاة">
              <Select value={offset} onChange={(e) => setOffset(e.target.value)}>
                {props.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="مركز التكلفة">
              <Select value={costCenterId} onChange={(e) => setCostCenter(e.target.value)}>
                <option value="">—</option>
                {props.centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameAr}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label={kind === "adjustment" ? "السبب" : "ملاحظات"}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "adjustment" ? "مثل: تالف أثناء النقل" : "اختياري"} />
        </Field>
      </section>

      {kind === "count" ? (
        <p className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-900">يُنشأ الجرد بكل الأصناف المخزنية وأرصدتها الحالية في المستودع. بعدها تُدخل الكميات المعدودة وتُرحّل الفروقات.</p>
      ) : (
        <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="p-2 text-start">الصنف</th>
                <th className="w-32 p-2 text-start">الرصيد الحالي</th>
                <th className="w-32 p-2 text-start">الكمية</th>
                {kind === "adjustment" && direction === "in" && <th className="w-36 p-2 text-start">تكلفة الوحدة</th>}
                <th className="w-32 p-2 text-start">القيمة</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = product(l.productId);
                const cost = kind === "adjustment" && direction === "in" && l.unitCost ? Number(l.unitCost) : (p?.avg ?? 0);
                const over = p && kind !== "adjustment" ? Number(l.quantity) > have(l.productId, warehouseId) : p && direction === "out" && Number(l.quantity) > have(l.productId, warehouseId);
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="p-1.5">
                      <select value={l.productId} onChange={(e) => set(i, { productId: e.target.value })} className={cell}>
                        <option value="">اختر الصنف</option>
                        {props.products.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="ltr-nums p-1.5 text-gray-600">{p ? `${have(l.productId, warehouseId)} ${p.unit}` : ""}</td>
                    <td className="p-1.5">
                      <input value={l.quantity} inputMode="decimal" onChange={(e) => set(i, { quantity: e.target.value })} className={`${cell} ltr-nums ${over ? "border-red-300 bg-red-50" : ""}`} />
                    </td>
                    {kind === "adjustment" && direction === "in" && (
                      <td className="p-1.5">
                        <input value={l.unitCost} inputMode="decimal" placeholder={p ? String(p.avg) : ""} onChange={(e) => set(i, { unitCost: e.target.value })} className={`${cell} ltr-nums`} />
                      </td>
                    )}
                    <td className="ltr-nums p-1.5">{p && Number(l.quantity) ? fmt(Number(l.quantity) * cost) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold">
                <td className="p-2">
                  <button type="button" onClick={() => setLines([...lines, empty()])} className="text-xs font-normal text-brand-700 hover:underline">
                    + أضف سطراً
                  </button>
                </td>
                <td colSpan={kind === "adjustment" && direction === "in" ? 3 : 2} />
                <td className="ltr-nums p-2">{fmt(total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm whitespace-pre-line text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {kind === "count" ? (
          <button type="button" disabled={pending} onClick={() => submit(false)} className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500 disabled:opacity-50">
            {pending ? "جارٍ الإنشاء…" : "إنشاء الجرد"}
          </button>
        ) : (
          <>
            <button type="button" disabled={pending || !filled.length} onClick={() => submit(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50">
              حفظ مسودة
            </button>
            {props.canPost && (
              <button type="button" disabled={pending || !filled.length} onClick={() => submit(true)} className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500 disabled:opacity-50">
                {pending ? "جارٍ الترحيل…" : "حفظ وترحيل"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
