"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import type { ReceiptKind } from "@/lib/receipts";
import { PAYMENT_METHODS } from "@/data/sales";
import { Icon, Truck } from "@/components/icons";
import { ComboBox } from "@/components/combo-box";
import { customerOpenItems, saveReceipt } from "../actions";
import { fmt } from "@/lib/format";
import { DateInput } from "@/components/date-input";

type Option = { value: string; label: string };
type OpenInvoice = Awaited<ReturnType<typeof customerOpenItems>>["invoices"][number];
type Credit = Awaited<ReturnType<typeof customerOpenItems>>["credit"];

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const toNum = (v: string) => {
  const n = Number(v.replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return Number.isFinite(n) ? n : 0;
};
const inputCls =
  "h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-sm transition placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none";

function Row({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="grid items-start gap-1.5 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <span className="pt-2 text-sm text-gray-700">
        {label}
        {required && <span className="text-red-500">*</span>}
        {hint && <span className="block text-[11px] text-gray-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function ReceiptForm({
  kind,
  title,
  customers,
  cash,
  adjustmentAccounts,
  currencies,
  today,
  initialCustomer,
  initialInvoice,
  willPost,
}: {
  kind: ReceiptKind;
  title: string;
  customers: Option[];
  cash: (Option & { currency: string | null })[];
  adjustmentAccounts: (Option & { name: string })[];
  currencies: string[];
  today: string;
  initialCustomer: string;
  initialInvoice: number | null;
  willPost: boolean;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(initialCustomer);
  const [cashId, setCashId] = useState(cash.length === 1 ? cash[0].value : "");
  const [currency, setCurrency] = useState("SAR");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<keyof typeof PAYMENT_METHODS>("transfer");
  const [reference, setReference] = useState("");
  const [collector, setCollector] = useState("");
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<OpenInvoice[]>([]);
  const [credit, setCredit] = useState<Credit | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const loading = !!customerId && loadedKey !== `${customerId}|${currency}`;
  const [picked, setPicked] = useState<{ id: number; amount: string }[]>([]);
  const [picker, setPicker] = useState(false);
  const [adjustments, setAdjustments] = useState<{ accountId: string; description: string; amount: string }[]>([]);
  const [error, setError] = useState("");
  const [saving, start] = useTransition();
  const forPayment = kind === "invoice_payment";

  // فواتير العميل المفتوحة بعملة الدفع ورصيده الدائن
  useEffect(() => {
    if (!customerId) return;
    let live = true;
    customerOpenItems(Number(customerId), currency).then((res) => {
      if (!live) return;
      setOpen(res.invoices);
      setCredit(res.credit);
      setLoadedKey(`${customerId}|${currency}`);
      setPicked((prev) => {
        const kept = prev.filter((p) => res.invoices.some((i) => i.id === p.id));
        const pre = initialInvoice && res.invoices.find((i) => i.id === initialInvoice);
        return pre && !kept.length ? [{ id: pre.id, amount: String(r2(Number(pre.total) - Number(pre.paid))) }] : kept;
      });
    });
    return () => {
      live = false;
    };
  }, [customerId, currency, initialInvoice]);

  const byId = useMemo(() => new Map(open.map((i) => [i.id, i])), [open]);
  const balance = (i: OpenInvoice) => r2(Number(i.total) - Number(i.paid));
  const received = toNum(amount);
  const adjTotal = r2(adjustments.reduce((t, a) => t + toNum(a.amount), 0));
  const allocated = r2(picked.reduce((t, p) => t + toNum(p.amount), 0));
  const settle = r2(received + adjTotal);
  const diff = r2(settle - allocated);
  const overAllocated = picked.some((p) => toNum(p.amount) > balance(byId.get(p.id)!) + 0.005);
  const refundTooBig = kind === "refund" && credit != null && received > credit.available + 0.005 && currency === "SAR";
  const notPicked = open.filter((i) => !picked.some((p) => p.id === i.id));

  const autoDistribute = (base = picked.map((p) => p.id)) => {
    // يوزع المبلغ المستلم والتعديلات على الفواتير المختارة بالأقدم استحقاقاً
    const ids = base.length ? base : open.map((i) => i.id);
    let left = settle;
    setPicked(
      ids
        .map((id) => byId.get(id)!)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id)
        .map((i) => {
          const take = r2(Math.max(0, Math.min(left, balance(i))));
          left = r2(left - take);
          return { id: i.id, amount: take ? String(take) : "" };
        }),
    );
  };

  const cashCurrency = cash.find((c) => c.value === cashId)?.currency;
  const canSave =
    !!customerId && !!cashId && received > 0 && !!date && !saving && (!forPayment || (diff >= -0.005 && !overAllocated)) && !refundTooBig && (!cashCurrency || cashCurrency === currency);

  const submit = () => {
    setError("");
    start(async () => {
      const res = await saveReceipt({
        kind,
        customerId: Number(customerId),
        cashAccountId: Number(cashId),
        currencyCode: currency,
        amount: received,
        receiptDate: date,
        method,
        notes,
        reference,
        collector,
        allocations: forPayment ? picked.map((p) => ({ invoiceId: p.id, amount: toNum(p.amount) })).filter((a) => a.amount > 0) : [],
        adjustments: forPayment ? adjustments.map((a) => ({ accountId: Number(a.accountId), amount: toNum(a.amount), description: a.description })).filter((a) => a.accountId && a.amount > 0) : [],
      });
      if (res.error) setError(res.error);
      else router.push(`/receipts?open=${res.id}`);
    });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="sticky top-0 z-20 -mx-1 mb-4 flex flex-wrap items-center gap-3 border-b border-gray-200 bg-[var(--color-gray-50,#f7f7f5)]/95 px-1 py-3 backdrop-blur">
        <h1 className="font-display text-2xl font-semibold text-brand-900">{title}</h1>
        <div className="ms-auto flex items-center gap-2">
          <button type="button" onClick={() => router.back()} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100">
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Truck className="w-7" spinning /> : <Icon name="check" className="size-4" />}
            {willPost ? "تسجيل" : "حفظ مسودة"}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="rounded-2xl border border-black/[0.06] bg-white shadow-sm">
        <div className="flex items-center justify-between rounded-t-2xl bg-gray-50 px-5 py-2.5 text-sm">
          <span className="font-semibold text-gray-800">معلومات أساسية</span>
          <span className="text-xs text-gray-400">مطلوب</span>
        </div>
        <div className="flex max-w-2xl flex-col gap-3.5 p-5">
          <Row label="العميل" required>
            <ComboBox value={customerId} options={customers} onChange={(v) => setCustomerId(v)} create="customer" placeholder="ابحث عن العميل…" className={inputCls} />
          </Row>
          <Row label={kind === "refund" ? "تم الصرف من خلال" : "تم الدفع من خلال"} required hint="الصندوق أو البنك">
            <select value={cashId} onChange={(e) => setCashId(e.target.value)} className={inputCls}>
              <option value="">اختر الحساب</option>
              {cash.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {cashCurrency && cashCurrency !== currency && <span className="text-xs text-red-700">الحساب بعملة {cashCurrency}</span>}
          </Row>
          <Row label="عملة الدفع" required>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Row>
          <Row label={kind === "refund" ? "المبلغ المسترد" : "المبلغ المستلم"} required>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className={`${inputCls} ltr-nums`} />
            {kind === "refund" && credit && (
              <span className={`text-xs ${refundTooBig ? "text-red-700" : "text-gray-500"}`}>
                الرصيد الدائن المتاح للعميل: <b className="ltr-nums">{fmt(credit.available)}</b> ريال
                {credit.advances > 0 && <span> (منه دفعات مقدمة {fmt(credit.advances)})</span>}
              </span>
            )}
          </Row>
          <Row label="التاريخ" required>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} ltr-nums`} />
          </Row>
          <Row label="الوصف">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="غير محدد" className={`${inputCls} h-auto py-2`} />
          </Row>
        </div>
        <button type="button" onClick={() => setMore(!more)} className="flex w-full items-center justify-between border-t border-gray-100 bg-gray-50 px-5 py-2.5 text-sm">
          <span>
            <span className="font-semibold text-gray-800">معلومات إضافية</span> <span className="text-xs text-gray-400">اختياري</span>
          </span>
          <svg viewBox="0 0 24 24" className={`size-4 transition ${more ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {more && (
          <div className="flex max-w-2xl flex-col gap-3.5 p-5">
            <Row label="طريقة الدفع">
              <select value={method} onChange={(e) => setMethod(e.target.value as keyof typeof PAYMENT_METHODS)} className={inputCls}>
                {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="المرجع / رقم الشيك">
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} dir="ltr" />
            </Row>
            <Row label="المحصّل">
              <input value={collector} onChange={(e) => setCollector(e.target.value)} className={inputCls} />
            </Row>
          </div>
        )}
      </section>

      {forPayment && (
        <section className="mt-5 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="font-semibold text-brand-900">سجّل هذه الدفعة للفواتير التالية</h2>
            {customerId && !loading && (
              <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs text-sky-800 ring-1 ring-sky-200">
                للعميل <b className="ltr-nums">{open.length}</b> فاتورة مفتوحة بعملة {currency}
              </span>
            )}
            <div className="ms-auto flex gap-3 text-xs">
              <button type="button" disabled={!open.length || !(settle > 0)} onClick={() => autoDistribute()} className="text-brand-700 hover:underline disabled:text-gray-300 disabled:no-underline">
                توزيع تلقائي
              </button>
              <button type="button" disabled={!picked.length} onClick={() => setPicked(picked.map((p) => ({ ...p, amount: "" })))} className="text-brand-700 hover:underline disabled:text-gray-300 disabled:no-underline">
                مسح التوزيعات
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-2 text-start font-medium">فاتورة</th>
                  <th className="px-2 py-2 text-start font-medium">التاريخ</th>
                  <th className="px-2 py-2 text-end font-medium">المبلغ</th>
                  <th className="px-2 py-2 text-end font-medium">الرصيد</th>
                  <th className="w-40 px-2 py-2 text-end font-medium">توزيع المبلغ المدفوع</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {!customerId && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-gray-400">
                      اختر العميل لسحب الفواتير
                    </td>
                  </tr>
                )}
                {customerId && loading && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center">
                      <Truck className="mx-auto w-12" spinning />
                    </td>
                  </tr>
                )}
                {picked.map((p) => {
                  const i = byId.get(p.id);
                  if (!i) return null;
                  const over = toNum(p.amount) > balance(i) + 0.005;
                  return (
                    <tr key={p.id} className="animate-rise">
                      <td className="ltr-nums px-2 py-2 font-medium">
                        {i.number}
                        {i.reference && <span className="ms-1 text-xs text-gray-400">({i.reference})</span>}
                      </td>
                      <td className="ltr-nums px-2 py-2 text-gray-600">{i.invoiceDate}</td>
                      <td className="ltr-nums px-2 py-2 text-end">{fmt(Number(i.total))}</td>
                      <td className="ltr-nums px-2 py-2 text-end text-gray-600">{fmt(balance(i))}</td>
                      <td className="px-2 py-1.5">
                        <input
                          value={p.amount}
                          inputMode="decimal"
                          onChange={(e) => setPicked(picked.map((x) => (x.id === p.id ? { ...x, amount: e.target.value } : x)))}
                          onDoubleClick={() => setPicked(picked.map((x) => (x.id === p.id ? { ...x, amount: String(balance(i)) } : x)))}
                          title="انقر مرتين لسداد الرصيد كاملاً"
                          className={`${inputCls} ltr-nums text-end ${over ? "border-red-400 bg-red-50" : ""}`}
                        />
                      </td>
                      <td className="px-1">
                        <button type="button" aria-label="إزالة" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600">
                          <Icon name="close" className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {customerId && !loading && (
            <div className="relative mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!notPicked.length}
                onClick={() => setPicker(!picker)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              >
                + أضف فاتورة {notPicked.length > 0 && <span className="ltr-nums text-xs text-gray-400">({notPicked.length})</span>}
              </button>
              {notPicked.length > 1 && (
                <button type="button" onClick={() => autoDistribute([...picked.map((p) => p.id), ...notPicked.map((i) => i.id)])} className="text-xs text-brand-700 hover:underline">
                  إضافة كل الفواتير وتوزيع المبلغ
                </button>
              )}
              {!open.length && <span className="text-xs text-gray-400">لا توجد فواتير مُصدرة غير مسددة لهذا العميل؛ المبلغ سيبقى رصيداً دائناً له.</span>}
              {picker && notPicked.length > 0 && (
                <div className="animate-flyout absolute start-0 top-full z-20 mt-1 max-h-72 w-full max-w-lg overflow-y-auto rounded-xl border border-black/[0.06] bg-white shadow-lg">
                  {notPicked.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => {
                        const left = r2(settle - allocated);
                        setPicked([...picked, { id: i.id, amount: left > 0 ? String(Math.min(left, balance(i))) : "" }]);
                        if (notPicked.length === 1) setPicker(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start text-sm hover:bg-brand-50"
                    >
                      <span>
                        <span className="ltr-nums font-medium">{i.number}</span> <span className="ltr-nums text-xs text-gray-500">{i.invoiceDate}</span>
                        {i.dueDate < today && <span className="ms-2 rounded bg-red-50 px-1.5 text-[11px] text-red-700">متأخرة</span>}
                      </span>
                      <span className="ltr-nums text-xs text-gray-600">الرصيد {fmt(balance(i))}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-5 ms-auto max-w-md space-y-2 border-t border-gray-100 pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">إجمالي المبالغ الموزعة</span>
              <span className="ltr-nums font-semibold">{fmt(allocated)}</span>
            </div>
            {adjustments.map((a, n) => (
              <div key={n} className="grid animate-rise grid-cols-[1fr_6.5rem_auto] items-center gap-2">
                <select
                  value={a.accountId}
                  onChange={(e) => {
                    const acc = adjustmentAccounts.find((x) => x.value === e.target.value);
                    setAdjustments(adjustments.map((x, i) => (i === n ? { ...x, accountId: e.target.value, description: x.description || acc?.name || "" } : x)));
                  }}
                  className={`${inputCls} h-8 text-xs`}
                >
                  <option value="">نوع التعديل (الحساب)</option>
                  {adjustmentAccounts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  value={a.amount}
                  inputMode="decimal"
                  placeholder="0.00"
                  onChange={(e) => setAdjustments(adjustments.map((x, i) => (i === n ? { ...x, amount: e.target.value } : x)))}
                  className={`${inputCls} ltr-nums h-8 text-end`}
                />
                <button type="button" aria-label="حذف التعديل" onClick={() => setAdjustments(adjustments.filter((_, i) => i !== n))} className="p-1 text-gray-400 hover:text-red-600">
                  <Icon name="close" className="size-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setAdjustments([...adjustments, { accountId: "", description: "", amount: "" }])} className="text-xs text-brand-700 hover:underline">
              + أضف تعديل (خصم مسموح به، رسوم بنكية)
            </button>
            <div className="flex justify-between border-t border-gray-100 pt-2">
              <span className="text-gray-600">المبلغ المدفوع</span>
              <span className="ltr-nums font-semibold">{fmt(received)}</span>
            </div>
            {adjTotal > 0 && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>يسوي من الفواتير (المدفوع + التعديلات)</span>
                <span className="ltr-nums">{fmt(settle)}</span>
              </div>
            )}
            {diff > 0.005 && received > 0 && (
              <div className="flex justify-between rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <span>دفع زائد غير موزع؛ يبقى رصيداً دائناً للعميل</span>
                <span className="ltr-nums font-semibold">{fmt(diff)}</span>
              </div>
            )}
            {diff < -0.005 && (
              <div className="flex justify-between rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                <span>الموزع على الفواتير أكبر من المبلغ المدفوع</span>
                <span className="ltr-nums font-semibold">{fmt(-diff)}</span>
              </div>
            )}
            {overAllocated && <div className="text-xs text-red-700">مبلغ إحدى الفواتير أكبر من رصيدها.</div>}
            {Math.abs(diff) <= 0.005 && received > 0 && picked.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                <Icon name="check" className="size-4" />
                المبلغ موزع بالكامل على الفواتير
              </div>
            )}
          </div>
        </section>
      )}

      {kind === "advance" && (
        <p className="mt-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
          تُسجل الدفعة المقدمة في حساب «دفعات مقدمة من العملاء» ثم تطبقها على فواتير العميل لاحقاً من معاينة السند.
        </p>
      )}
      {!willPost && <p className="mt-3 text-xs text-gray-500">يُحفظ السند مسودة بتوزيعه حتى يرحّله من يملك صلاحية الاعتماد.</p>}
    </div>
  );
}
