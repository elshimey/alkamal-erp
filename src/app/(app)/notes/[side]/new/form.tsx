"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { NOTE_KINDS, NOTE_SIDES, type NoteKind, type NoteSide } from "@/data/sales";
import { Icon, Truck } from "@/components/icons";
import { invoiceLines, partyInvoices, saveNote } from "../actions";
import { fmt } from "@/lib/format";
import { DateInput } from "@/components/date-input";

type Option = { value: string; label: string };
type Inv = Awaited<ReturnType<typeof partyInvoices>>[number];
type Line = { description: string; accountId: string; costCenterId: string; amount: string; vatRate: string };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const toNum = (v: string) => {
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const inputCls =
  "h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-sm transition placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none";
const emptyLine = (): Line => ({ description: "", accountId: "", costCenterId: "", amount: "", vatRate: "15" });

function Row({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="grid items-start gap-1.5 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <span className="pt-2 text-sm text-gray-700">
        {label}
        {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

export function NoteForm({
  side,
  kind: initialKind,
  parties,
  accounts,
  centers,
  currencies,
  today,
  initialParty,
  initialInvoice,
  willPost,
}: {
  side: NoteSide;
  kind: NoteKind;
  parties: Option[];
  accounts: Option[];
  centers: Option[];
  currencies: string[];
  today: string;
  initialParty: string;
  initialInvoice: number | null;
  willPost: boolean;
}) {
  const router = useRouter();
  const cfg = NOTE_SIDES[side];
  const [kind, setKind] = useState<NoteKind>(initialKind);
  const [partyId, setPartyId] = useState(initialParty);
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [invoiceId, setInvoiceId] = useState(initialInvoice ? String(initialInvoice) : "");
  const [currency, setCurrency] = useState("SAR");
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, start] = useTransition();

  useEffect(() => {
    if (!partyId) return;
    let live = true;
    partyInvoices(side, Number(partyId)).then((rows) => {
      if (!live) return;
      setInvoices(rows);
      setInvoiceId((cur) => (rows.some((r) => String(r.id) === cur) ? cur : ""));
    });
    return () => {
      live = false;
    };
  }, [partyId, side]);

  const invoice = invoices.find((i) => String(i.id) === invoiceId);
  const cur = invoice?.currencyCode ?? currency;
  const set = (n: number, patch: Partial<Line>) => setLines(lines.map((l, i) => (i === n ? { ...l, ...patch } : l)));
  const subtotal = r2(lines.reduce((t, l) => t + toNum(l.amount), 0));
  const vat = r2(lines.reduce((t, l) => t + r2((toNum(l.amount) * toNum(l.vatRate)) / 100), 0));
  const total = r2(subtotal + vat);
  const balance = invoice ? r2(Number(invoice.total) - Number(invoice.paid)) : 0;
  const reduces = NOTE_KINDS[kind].reduces;
  const valid = partyId && reason.trim() && date && lines.some((l) => toNum(l.amount) > 0 && l.accountId) && lines.every((l) => !toNum(l.amount) || l.accountId);

  const fillFromInvoice = () => {
    if (!invoice) return;
    setLoading(true);
    invoiceLines(side, invoice.id).then((rows) => {
      setLines(rows.map((r) => ({ description: r.description, accountId: String(r.accountId), costCenterId: r.costCenterId ? String(r.costCenterId) : "", amount: String(r.amount), vatRate: String(r.vatRate) })));
      setLoading(false);
    });
  };

  const submit = () =>
    start(async () => {
      setError("");
      const res = await saveNote({
        kind,
        noteDate: date,
        partyId: Number(partyId),
        invoiceId: invoice ? invoice.id : null,
        currencyCode: cur,
        reason,
        lines: lines.filter((l) => toNum(l.amount) > 0).map((l) => ({ description: l.description, accountId: Number(l.accountId), costCenterId: l.costCenterId ? Number(l.costCenterId) : null, amount: toNum(l.amount), vatRate: toNum(l.vatRate) })),
      });
      if (res.error) setError(res.error);
      else router.push(`/notes/${side}?open=${res.id}`);
    });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="sticky top-0 z-20 -mx-1 mb-4 flex flex-wrap items-center gap-3 border-b border-gray-200 bg-[var(--color-gray-50,#f7f7f5)]/95 px-1 py-3 backdrop-blur">
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-sm" role="tablist">
          {cfg.kinds.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-md px-3 py-1.5 transition ${kind === k ? "bg-white font-semibold text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
              {NOTE_KINDS[k].label}
            </button>
          ))}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <button type="button" onClick={() => router.back()} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100">
            إلغاء
          </button>
          <button type="button" onClick={submit} disabled={!valid || saving} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Truck className="w-7" spinning /> : <Icon name="check" className="size-4" />}
            {willPost ? "حفظ وترحيل" : "حفظ مسودة"}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
        <div className="flex max-w-2xl flex-col gap-3.5">
          <Row label={cfg.party} required>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputCls}>
              <option value="">اختر</option>
              {parties.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="الفاتورة الأصلية">
            <div className="flex gap-2">
              <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} disabled={!partyId} className={inputCls}>
                <option value="">بدون فاتورة</option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} · {i.date} · {fmt(Number(i.total))} {i.currencyCode}
                  </option>
                ))}
              </select>
              <button type="button" onClick={fillFromInvoice} disabled={!invoice || loading} className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                نسخ سطورها
              </button>
            </div>
            {invoice && (
              <span className="text-xs text-gray-500">
                رصيد الفاتورة <b className="ltr-nums">{fmt(balance)}</b> {invoice.currencyCode}
                {reduces && total > balance + 0.005 && <span className="text-amber-700"> · الزائد عن الرصيد يبقى رصيداً دائناً لل{cfg.party}</span>}
              </span>
            )}
          </Row>
          {!invoice && (
            <Row label="العملة" required>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Row>
          )}
          <Row label="التاريخ" required>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} ltr-nums`} />
          </Row>
          <Row label="سبب الإشعار" required>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reduces ? "مرتجع، خصم لاحق، تصحيح سعر…" : "فرق سعر، رسوم إضافية…"} className={inputCls} />
          </Row>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-brand-900">السطور</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b border-gray-200 text-xs text-gray-500">
              <tr>
                <th className="px-1 py-2 text-start font-medium">البيان</th>
                <th className="w-56 px-1 py-2 text-start font-medium">الحساب</th>
                <th className="w-40 px-1 py-2 text-start font-medium">مركز التكلفة</th>
                <th className="w-28 px-1 py-2 text-end font-medium">المبلغ</th>
                <th className="w-24 px-1 py-2 text-start font-medium">الضريبة</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, n) => (
                <tr key={n} className="animate-rise">
                  <td className="px-1 py-1">
                    <input value={l.description} onChange={(e) => set(n, { description: e.target.value })} className={inputCls} />
                  </td>
                  <td className="px-1 py-1">
                    <select value={l.accountId} onChange={(e) => set(n, { accountId: e.target.value })} className={inputCls}>
                      <option value="">اختر الحساب</option>
                      {accounts.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select value={l.costCenterId} onChange={(e) => set(n, { costCenterId: e.target.value })} className={inputCls}>
                      <option value="">—</option>
                      {centers.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input value={l.amount} inputMode="decimal" placeholder="0.00" onChange={(e) => set(n, { amount: e.target.value })} className={`${inputCls} ltr-nums text-end`} />
                  </td>
                  <td className="px-1 py-1">
                    <select value={l.vatRate} onChange={(e) => set(n, { vatRate: e.target.value })} className={inputCls}>
                      <option value="15">15%</option>
                      <option value="0">صفر</option>
                    </select>
                  </td>
                  <td className="px-1">
                    {lines.length > 1 && (
                      <button type="button" aria-label="حذف السطر" onClick={() => setLines(lines.filter((_, i) => i !== n))} className="p-1 text-gray-400 hover:text-red-600">
                        <Icon name="close" className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => setLines([...lines, emptyLine()])} className="mt-2 text-xs text-brand-700 hover:underline">
          + أضف سطراً
        </button>
        <dl className="mt-4 ms-auto max-w-xs space-y-1.5 border-t border-gray-100 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-600">قبل الضريبة</dt>
            <dd className="ltr-nums">{fmt(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">الضريبة</dt>
            <dd className="ltr-nums">{fmt(vat)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>الإجمالي</dt>
            <dd className="ltr-nums">
              {fmt(total)} <span className="text-xs font-normal text-gray-400">{cur}</span>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
