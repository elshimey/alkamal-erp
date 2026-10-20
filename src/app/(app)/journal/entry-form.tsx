"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ClipboardEvent } from "react";
import { Icon, Truck } from "@/components/icons";
import { saveEntry } from "./actions";

type Option = { value: string; label: string; code?: string; cc?: boolean };
export type EntryLine = { accountId: string; description: string; costCenterId: string; partyId: string; debit: string; credit: string };
export interface EntryInitial {
  entryDate: string;
  description: string;
  reference: string;
  lines: EntryLine[];
}

const fmt = (v: number) => v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const toNum = (v: string) => {
  const n = Number(v.replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return Number.isFinite(n) ? n : 0;
};
const cell =
  "h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-sm transition hover:border-gray-200 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20 focus:outline-none";
const inputCls =
  "h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none";
export const emptyLine = (): EntryLine => ({ accountId: "", description: "", costCenterId: "", partyId: "", debit: "", credit: "" });

export function EntryForm({ accounts, centers, parties, initial, entryId, canPost }: { accounts: Option[]; centers: Option[]; parties: Option[]; initial: EntryInitial; entryId?: number; canPost: boolean }) {
  const router = useRouter();
  const [date, setDate] = useState(initial.entryDate);
  const [description, setDescription] = useState(initial.description);
  const [reference, setReference] = useState(initial.reference);
  const [lines, setLines] = useState<EntryLine[]>(initial.lines.length >= 2 ? initial.lines : [...initial.lines, ...Array.from({ length: 2 - initial.lines.length }, emptyLine)]);
  const [error, setError] = useState("");
  const [saving, start] = useTransition();
  const byAccount = new Map(accounts.map((a) => [a.value, a]));

  const set = (n: number, patch: Partial<EntryLine>) => setLines(lines.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const debit = r2(lines.reduce((t, l) => t + toNum(l.debit), 0));
  const credit = r2(lines.reduce((t, l) => t + toNum(l.credit), 0));
  const diff = r2(debit - credit);
  const used = lines.filter((l) => l.accountId && (toNum(l.debit) || toNum(l.credit)));
  const missingCc = used.some((l) => byAccount.get(l.accountId)?.cc && !l.costCenterId);
  const ok = used.length >= 2 && Math.abs(diff) < 0.005 && debit > 0 && description.trim() && date && !missingCc;

  // اللصق من Excel: الحساب (رقم أو اسم) | الوصف | مدين | دائن | مركز التكلفة
  const onPaste = (n: number) => (e: ClipboardEvent<HTMLElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const find = (raw: string, list: Option[]) => {
      const t = raw.trim();
      if (!t) return "";
      return (list.find((o) => o.code === t) ?? list.find((o) => o.label === t) ?? list.find((o) => o.label.includes(t)))?.value ?? "";
    };
    const rows = text.replace(/\r/g, "").split("\n").filter((r) => r.trim());
    const parsed = rows.map((r) => {
      const [acc = "", desc = "", d = "", c = "", cc = ""] = r.split("\t");
      return { ...emptyLine(), accountId: find(acc, accounts), description: desc.trim(), debit: toNum(d) ? String(toNum(d)) : "", credit: toNum(c) ? String(toNum(c)) : "", costCenterId: find(cc, centers) };
    });
    const next = [...lines];
    next.splice(n, parsed.length, ...parsed);
    setLines(next);
  };

  const balanceLast = () => {
    const i = lines.findIndex((l) => !toNum(l.debit) && !toNum(l.credit));
    const target = i === -1 ? lines.length : i;
    const patch = diff > 0 ? { credit: String(diff), debit: "" } : { debit: String(-diff), credit: "" };
    const next = [...lines];
    next[target] = { ...(next[target] ?? emptyLine()), ...patch };
    setLines(next);
  };

  const submit = (post: boolean) =>
    start(async () => {
      setError("");
      const res = await saveEntry(
        {
          entryDate: date,
          description,
          reference,
          post,
          lines: used.map((l) => ({ accountId: Number(l.accountId), description: l.description, debit: toNum(l.debit), credit: toNum(l.credit), costCenterId: l.costCenterId ? Number(l.costCenterId) : null, partyId: l.partyId ? Number(l.partyId) : null })),
        },
        entryId,
      );
      if (res.error) setError(res.error);
      else router.push(`/journal?open=${res.id}`);
    });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="sticky top-0 z-20 -mx-1 mb-4 flex flex-wrap items-center gap-3 border-b border-gray-200 bg-[var(--color-gray-50,#f7f7f5)]/95 px-1 py-3 backdrop-blur">
        <h1 className="font-display text-2xl font-semibold text-brand-900">{entryId ? "تعديل قيد يومية" : "قيد يومية جديد"}</h1>
        <div className="ms-auto flex items-center gap-2">
          <button type="button" onClick={() => router.back()} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100">
            إلغاء
          </button>
          <button type="button" disabled={!ok || saving} onClick={() => submit(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50">
            حفظ مسودة
          </button>
          {canPost && (
            <button type="button" disabled={!ok || saving} onClick={() => submit(true)} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500 disabled:opacity-50">
              {saving ? <Truck className="w-7" spinning /> : <Icon name="check" className="size-4" />}
              حفظ وترحيل
            </button>
          )}
        </div>
      </div>
      {error && <div className="mb-4 whitespace-pre-line rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="grid gap-4 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm sm:grid-cols-[10rem_12rem_1fr]">
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">
            التاريخ<span className="text-red-500">*</span>
          </span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} ltr-nums`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">المرجع</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="اختياري" className={inputCls} dir="ltr" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">
            الوصف<span className="text-red-500">*</span>
          </span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثل: قيد افتتاحي، تسوية، استحقاق إيجار…" className={inputCls} />
        </label>
      </section>

      <section className="mt-5 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-brand-900">السطور</h2>
          <span className="text-xs text-gray-400">يمكنك لصق سطور من Excel بالترتيب: الحساب، الوصف، مدين، دائن، مركز التكلفة</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="w-8 py-2" />
                <th className="w-64 px-1 py-2 text-start font-medium">الحساب</th>
                <th className="px-1 py-2 text-start font-medium">الوصف</th>
                <th className="w-40 px-1 py-2 text-start font-medium">مركز التكلفة</th>
                <th className="w-40 px-1 py-2 text-start font-medium">الجهة</th>
                <th className="w-28 px-1 py-2 text-end font-medium">مدين</th>
                <th className="w-28 px-1 py-2 text-end font-medium">دائن</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l, n) => {
                const needCc = byAccount.get(l.accountId)?.cc && !l.costCenterId && (toNum(l.debit) || toNum(l.credit));
                return (
                  <tr key={n} className="group" onPaste={onPaste(n)}>
                    <td className="ltr-nums py-1 text-center text-xs text-gray-400">{n + 1}</td>
                    <td className="px-1 py-1">
                      <select value={l.accountId} onChange={(e) => set(n, { accountId: e.target.value })} className={cell}>
                        <option value="">اختر الحساب</option>
                        {accounts.map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input value={l.description} onChange={(e) => set(n, { description: e.target.value })} className={cell} />
                    </td>
                    <td className="px-1 py-1">
                      <select value={l.costCenterId} onChange={(e) => set(n, { costCenterId: e.target.value })} className={`${cell} ${needCc ? "border-red-300 bg-red-50" : ""}`}>
                        <option value="">{needCc ? "مطلوب" : "—"}</option>
                        {centers.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <select value={l.partyId} onChange={(e) => set(n, { partyId: e.target.value })} className={cell}>
                        <option value="">—</option>
                        {parties.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input value={l.debit} inputMode="decimal" placeholder="0.00" onChange={(e) => set(n, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} className={`${cell} ltr-nums text-end`} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={l.credit} inputMode="decimal" placeholder="0.00" onChange={(e) => set(n, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} className={`${cell} ltr-nums text-end`} />
                    </td>
                    <td className="px-1">
                      {lines.length > 2 && (
                        <button type="button" aria-label="حذف السطر" onClick={() => setLines(lines.filter((_, i) => i !== n))} className="p-1 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-600">
                          <Icon name="close" className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 text-sm font-semibold">
              <tr>
                <td colSpan={5} className="px-1 py-2">
                  <button type="button" onClick={() => setLines([...lines, emptyLine()])} className="text-xs font-normal text-brand-700 hover:underline">
                    + أضف سطراً
                  </button>
                  {Math.abs(diff) >= 0.005 && debit + credit > 0 && (
                    <button type="button" onClick={balanceLast} className="ms-4 text-xs font-normal text-brand-700 hover:underline">
                      موازنة الفرق في سطر
                    </button>
                  )}
                </td>
                <td className="ltr-nums px-3 py-2 text-end">{fmt(debit)}</td>
                <td className="ltr-nums px-3 py-2 text-end">{fmt(credit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-2 text-end text-xs">
          {Math.abs(diff) < 0.005 && debit > 0 ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <Icon name="check" className="size-4" /> القيد متوازن
            </span>
          ) : debit + credit > 0 ? (
            <span className="text-red-700">
              الفرق <span className="ltr-nums font-semibold">{fmt(Math.abs(diff))}</span> {diff > 0 ? "زيادة في المدين" : "زيادة في الدائن"}
            </span>
          ) : null}
          {missingCc && <span className="ms-3 text-red-700">بعض الحسابات تتطلب مركز تكلفة</span>}
        </div>
      </section>
    </div>
  );
}
