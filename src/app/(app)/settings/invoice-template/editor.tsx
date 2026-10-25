"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import type { CompanyProfile } from "@/lib/company";
import { DEFAULT_TEMPLATE, TEMPLATE_ACCENTS, TEMPLATE_LAYOUTS, type InvoiceTemplate } from "@/lib/invoice-template";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { TaxInvoiceDocument } from "@/components/tax-invoice";
import { Field, Input } from "@/components/ui";
import { saveTemplateAction } from "./actions";

type DocProps = ComponentProps<typeof TaxInvoiceDocument>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-gray-100 pb-5 last:border-0">
      <h3 className="mb-3 text-sm font-semibold text-gray-800">{title}</h3>
      {children}
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
      <span>
        <span className="block text-sm text-gray-700">{label}</span>
        {hint && <span className="block text-xs text-gray-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-brand-500" : "bg-gray-300"}`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? "start-[1.375rem]" : "start-0.5"}`} />
      </button>
    </label>
  );
}

/** محرر القالب: الخيارات يميناً والفاتورة تتغير مباشرة يساراً. */
export function TemplateEditor({
  initial,
  company,
  sample,
  qrSvg,
  canEdit,
}: {
  initial: InvoiceTemplate;
  company: CompanyProfile;
  sample: { i: DocProps["invoice"]; customer: DocProps["customer"]; lines: DocProps["lines"] };
  qrSvg: string | null;
  canEdit: boolean;
}) {
  const [t, setT] = useState(initial);
  const set = <K extends keyof InvoiceTemplate>(k: K, v: InvoiceTemplate[K]) => setT((x) => ({ ...x, [k]: v }));
  const changed = JSON.stringify(t) !== JSON.stringify(initial);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[22rem_1fr]">
      <ActionForm action={saveTemplateAction} resetOnSuccess={false} className="flex flex-col gap-5 rounded-2xl bg-white p-5 shadow-sm xl:sticky xl:top-4">
        <input type="hidden" name="template" value={JSON.stringify(t)} />
        <fieldset disabled={!canEdit} className="contents">
          <Section title="الشكل">
            <div className="grid gap-2">
              {Object.entries(TEMPLATE_LAYOUTS).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set("layout", k as InvoiceTemplate["layout"])}
                  className={`rounded-xl border-2 px-3 py-2.5 text-start transition ${t.layout === k ? "border-brand-500 bg-brand-50" : "border-gray-100 hover:border-gray-200"}`}
                >
                  <span className="block text-sm font-semibold text-gray-800">{l.label}</span>
                  <span className="block text-xs text-gray-500">{l.hint}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="اللون">
            <div className="flex flex-wrap gap-2.5">
              {Object.entries(TEMPLATE_ACCENTS).map(([k, a]) => (
                <button
                  key={k}
                  type="button"
                  title={a.label}
                  aria-label={a.label}
                  aria-pressed={t.accent === k}
                  onClick={() => set("accent", k as InvoiceTemplate["accent"])}
                  className={`flex size-10 items-center justify-center rounded-full ring-offset-2 transition ${t.accent === k ? "ring-2 ring-gray-800" : "hover:scale-105"}`}
                  style={{ background: `linear-gradient(135deg, ${a.dark} 50%, ${a.main} 50%)` }}
                />
              ))}
            </div>
            <div className="mt-2 text-xs text-gray-500">{TEMPLATE_ACCENTS[t.accent].label}</div>
          </Section>

          <Section title="اللغة">
            <div className="flex rounded-lg bg-gray-100 p-1 text-sm">
              {(
                [
                  ["bilingual", "عربي وإنجليزي"],
                  ["ar", "عربي فقط"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set("language", k)}
                  className={`flex-1 rounded-md py-1.5 transition ${t.language === k ? "bg-white font-semibold text-brand-900 shadow-sm" : "text-gray-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="ما يظهر في الفاتورة">
            <Toggle label="الشعار" checked={t.showLogo} onChange={(v) => set("showLogo", v)} />
            <Toggle label="رمز QR" hint="مطلوب في الفاتورة الضريبية" checked={t.showQr} onChange={(v) => set("showQr", v)} />
            <Toggle label="الرقم الضريبي وسجل العميل" checked={t.showCustomerIds} onChange={(v) => set("showCustomerIds", v)} />
            <Toggle label="خط الطريق المتقطع أسفل الفاتورة" checked={t.showRoadLine} onChange={(v) => set("showRoadLine", v)} />
          </Section>

          <Section title="الحساب البنكي">
            <Toggle label="إظهار بيانات التحويل" checked={t.showBank} onChange={(v) => set("showBank", v)} />
            {t.showBank && (
              <div className="mt-2 flex flex-col gap-3">
                <Field label="اسم البنك">
                  <Input value={t.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="مصرف الراجحي" />
                </Field>
                <Field label="اسم الحساب">
                  <Input value={t.accountName} onChange={(e) => set("accountName", e.target.value)} placeholder={company.nameAr} />
                </Field>
                <Field label="الآيبان">
                  <Input value={t.iban} onChange={(e) => set("iban", e.target.value.toUpperCase())} placeholder="SA0000000000000000000000" dir="ltr" />
                </Field>
              </div>
            )}
          </Section>

          <Section title="الشروط والتذييل">
            <div className="flex flex-col gap-3">
              <Field label="الشروط والأحكام" hint="تظهر أسفل الفاتورة، اتركها فارغة لإخفائها. عدد الأيام يُستبدل تلقائياً بمدة سداد العميل">
                <textarea
                  value={t.terms}
                  onChange={(e) => set("terms", e.target.value)}
                  rows={3}
                  maxLength={600}
                  placeholder="مثال: السداد خلال 30 يوماً من تاريخ الفاتورة."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                />
              </Field>
              <Field label="سطر التذييل">
                <Input value={t.footer} onChange={(e) => set("footer", e.target.value)} maxLength={600} />
              </Field>
            </div>
          </Section>

          {canEdit && (
            <div className="flex items-center gap-2">
              <SubmitButton className="flex-1">حفظ القالب</SubmitButton>
              <button type="button" onClick={() => setT(DEFAULT_TEMPLATE)} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100">
                الافتراضي
              </button>
            </div>
          )}
          {changed && <p className="-mt-3 text-xs text-amber-700">تعديلات غير محفوظة</p>}
        </fieldset>
      </ActionForm>

      <div className="rounded-2xl bg-gray-100/80 p-4 shadow-inner sm:p-8">
        <div className="mb-3 text-center text-xs text-gray-500">معاينة مباشرة على {sample.i.id ? `الفاتورة ${sample.i.number}` : "فاتورة نموذجية"}</div>
        <div className="mx-auto max-w-3xl">
          <TaxInvoiceDocument company={company} invoice={sample.i} customer={sample.customer} lines={sample.lines} qrSvg={qrSvg} template={t} />
        </div>
      </div>
    </div>
  );
}
