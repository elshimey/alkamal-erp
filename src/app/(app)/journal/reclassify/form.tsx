"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Field, Input, Select } from "@/components/ui";
import { findReclassLines, reclassifyAction } from "../actions";

type Opt = { value: string; label: string };
type Line = Awaited<ReturnType<typeof findReclassLines>>[number];
const fmt = (v: number) => v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReclassifyForm({ accounts, centers, today }: { accounts: Opt[]; centers: Opt[]; today: string }) {
  const [filter, setFilter] = useState({ accountId: "", costCenterId: "", from: "", to: "", q: "" });
  const [lines, setLines] = useState<Line[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState({ accountId: "", costCenterId: "", date: today, description: "" });
  const [msg, setMsg] = useState<{ ok?: string; error?: string; id?: number }>({});
  const [pending, start] = useTransition();
  const set = (k: keyof typeof filter) => (e: { target: { value: string } }) => setFilter((f) => ({ ...f, [k]: e.target.value }));

  const search = () =>
    start(async () => {
      setMsg({});
      if (!filter.accountId) return setMsg({ error: "اختر الحساب الحالي" });
      const rows = await findReclassLines({ accountId: Number(filter.accountId), costCenterId: filter.costCenterId ? Number(filter.costCenterId) : null, from: filter.from || undefined, to: filter.to || undefined, q: filter.q || undefined });
      setLines(rows);
      setPicked(new Set(rows.map((r) => r.id)));
    });

  const chosen = (lines ?? []).filter((l) => picked.has(l.id));
  const total = chosen.reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0);

  const submit = () =>
    start(async () => {
      if (!target.accountId && !target.costCenterId) return setMsg({ error: "اختر الحساب أو مركز التكلفة الجديد" });
      const r = await reclassifyAction({
        lineIds: chosen.map((l) => l.id),
        targetAccountId: Number(target.accountId || filter.accountId),
        targetCostCenterId: target.costCenterId ? Number(target.costCenterId) : null,
        date: target.date,
        description: target.description,
      });
      setMsg(r);
      if (r.ok) {
        setLines(null);
        setPicked(new Set());
      }
    });

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-brand-900">١. ابحث عن السطور</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="الحساب الحالي">
            <Select value={filter.accountId} onChange={set("accountId")}>
              <option value="">اختر</option>
              {accounts.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="مركز التكلفة">
            <Select value={filter.costCenterId} onChange={set("costCenterId")}>
              <option value="">الكل</option>
              {centers.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="من">
            <Input type="date" value={filter.from} onChange={set("from")} />
          </Field>
          <Field label="إلى">
            <Input type="date" value={filter.to} onChange={set("to")} />
          </Field>
          <Field label="يحتوي البيان">
            <Input value={filter.q} onChange={set("q")} placeholder="بحث" onKeyDown={(e) => e.key === "Enter" && search()} />
          </Field>
        </div>
        <button type="button" onClick={search} disabled={pending} className="mt-3 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60">
          {pending && !lines ? "جارٍ البحث…" : "بحث"}
        </button>
      </section>

      {lines && (
        <section className="rounded-2xl border border-black/[0.06] bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-3 text-sm">
            <h2 className="font-semibold text-brand-900">٢. حدد السطور</h2>
            <span className="text-gray-500">
              {chosen.length} من {lines.length} · الصافي <span className="ltr-nums font-semibold text-gray-900">{fmt(total)}</span>
            </span>
            <button type="button" className="ms-auto text-brand-700 hover:underline" onClick={() => setPicked(picked.size === lines.length ? new Set() : new Set(lines.map((l) => l.id)))}>
              {picked.size === lines.length ? "إلغاء الكل" : "تحديد الكل"}
            </button>
          </div>
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="w-10 p-2" />
                  <th className="p-2 text-start">القيد</th>
                  <th className="p-2 text-start">التاريخ</th>
                  <th className="p-2 text-start">البيان</th>
                  <th className="p-2 text-start">مركز التكلفة</th>
                  <th className="p-2 text-start">الجهة</th>
                  <th className="p-2 text-start">مدين</th>
                  <th className="p-2 text-start">دائن</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-gray-500">
                      لا توجد سطور مرحّلة بهذه الشروط
                    </td>
                  </tr>
                )}
                {lines.map((l) => (
                  <tr key={l.id} className={`border-t border-gray-100 ${picked.has(l.id) ? "bg-brand-50/50" : ""}`}>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={picked.has(l.id)}
                        onChange={() =>
                          setPicked((p) => {
                            const n = new Set(p);
                            if (n.has(l.id)) n.delete(l.id);
                            else n.add(l.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="p-2">
                      <Link href={`/journal?open=${l.entryId}`} target="_blank" className="ltr-nums text-brand-700 hover:underline">
                        {l.number}
                      </Link>
                    </td>
                    <td className="ltr-nums p-2 whitespace-nowrap">{l.date}</td>
                    <td className="p-2">{l.description}</td>
                    <td className="p-2">{l.costCenter ?? "—"}</td>
                    <td className="p-2">{l.party ?? "—"}</td>
                    <td className="ltr-nums p-2">{Number(l.debit) ? fmt(Number(l.debit)) : ""}</td>
                    <td className="ltr-nums p-2">{Number(l.credit) ? fmt(Number(l.credit)) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {lines && lines.length > 0 && (
        <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold text-brand-900">٣. انقلها إلى</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="الحساب الجديد" hint="اتركه لتغيير مركز التكلفة فقط">
              <Select value={target.accountId} onChange={(e) => setTarget((t) => ({ ...t, accountId: e.target.value }))}>
                <option value="">نفس الحساب</option>
                {accounts.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="مركز التكلفة الجديد" hint="فارغ = يبقى كما هو">
              <Select value={target.costCenterId} onChange={(e) => setTarget((t) => ({ ...t, costCenterId: e.target.value }))}>
                <option value="">كما هو</option>
                {centers.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="تاريخ قيد التصحيح">
              <Input type="date" value={target.date} onChange={(e) => setTarget((t) => ({ ...t, date: e.target.value }))} />
            </Field>
            <Field label="البيان">
              <Input value={target.description} onChange={(e) => setTarget((t) => ({ ...t, description: e.target.value }))} placeholder="اختياري" />
            </Field>
          </div>
          <button type="button" onClick={submit} disabled={pending || !chosen.length} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500 disabled:opacity-60">
            {pending ? "جارٍ الترحيل…" : `إعادة تصنيف ${chosen.length} سطر`}
          </button>
        </section>
      )}

      {msg.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg.error}</p>}
      {msg.ok && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          {msg.ok}
          {msg.id && (
            <>
              {" · "}
              <Link href={`/journal?open=${msg.id}`} className="underline">
                عرض القيد
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
