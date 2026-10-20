"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import type { ImportSpec } from "@/data/import-specs";
import { MISSING_LABELS, type ImportIssue, type ImportReport } from "@/lib/import-match";
import { toCsv } from "@/lib/sheet";
import { Icon, Truck } from "@/components/icons";
import { parseImportFile, runImportAction } from "../actions";

type Parsed = { headers: string[]; rows: string[][]; rowNumbers: number[] };

const btn = {
  primary: "inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
  secondary: "inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50",
  ghost: "rounded-lg px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-100",
};

function Steps({ step }: { step: number }) {
  const items = ["القالب والملف", "مطابقة الأعمدة", "التحقق والاستيراد"];
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2 text-sm">
      {items.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={`flex size-7 items-center justify-center rounded-full text-xs font-bold transition ${
              i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand-500 text-brand-900" : "bg-gray-200 text-gray-500"
            }`}
          >
            {i < step ? <Icon name="check" className="size-4" /> : i + 1}
          </span>
          <span className={i === step ? "font-semibold text-brand-900" : "text-gray-500"}>{label}</span>
          {i < items.length - 1 && <span className="mx-1 h-px w-8 border-t-2 border-dashed border-gray-300" />}
        </li>
      ))}
    </ol>
  );
}

function download(name: string, rows: string[][]) {
  const blob = new Blob([`﻿${toCsv(rows)}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ImportWizard({ spec }: { spec: ImportSpec }) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [enabled, setEnabled] = useState<boolean[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"parse" | "check" | "import" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fieldOf = useMemo(() => Object.fromEntries(spec.fields.map((f) => [f.key, f])), [spec]);
  const active = mapping.map((m, i) => (enabled[i] ? m : null));
  const mappedKeys = new Set(active.filter(Boolean) as string[]);
  const missingRequired = spec.fields.filter((f) => f.required && !mappedKeys.has(f.key));
  const step = report ? 2 : parsed ? 1 : 0;

  const upload = (file: File | undefined) => {
    if (!file) return;
    setError("");
    setReport(null);
    setFileName(file.name);
    const form = new FormData();
    form.set("file", file);
    setBusy("parse");
    start(async () => {
      const res = await parseImportFile(spec.entity, form);
      setBusy(null);
      if ("error" in res) {
        setError(res.error);
        setParsed(null);
        return;
      }
      setParsed(res);
      setMapping(res.mapping);
      // الأعمدة التي لا تقابل حقلاً تبقى مغلقة حتى يربطها المستخدم
      setEnabled(res.mapping.map((m) => m != null));
    });
  };

  const rowsPayload = () =>
    parsed!.rows.map((cells, i) => ({
      row: parsed!.rowNumbers[i],
      values: Object.fromEntries(active.flatMap((key, c) => (key ? [[key, cells[c] ?? ""]] : []))),
    }));

  const run = (dryRun: boolean) => {
    setError("");
    setBusy(dryRun ? "check" : "import");
    start(async () => {
      const res = await runImportAction(spec.entity, rowsPayload(), dryRun);
      setBusy(null);
      if (res.error) setError(res.error);
      setReport(res);
    });
  };

  // الحقل الواحد لعمود واحد: اختياره هنا يفكه من العمود السابق ويغلقه
  const setField = (col: number, key: string | null) => {
    setEnabled(enabled.map((e, i) => (i === col ? key != null : key && mapping[i] === key ? false : e)));
    setMapping(mapping.map((m, i) => (i === col ? key : key && m === key ? null : m)));
  };

  const reset = () => {
    setParsed(null);
    setReport(null);
    setError("");
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer.files[0]);
  };

  return (
    <div className="animate-rise">
      <Steps step={step} />

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {!parsed && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name="download" className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold text-brand-900">١. نزّل قالب الاستيراد</h2>
                <p className="text-xs text-gray-500">أعمدته مطابقة للنظام، وفيه ورقة «القوائم» بالقيم المعرفة لديك</p>
              </div>
            </div>
            <a href={`/import/${spec.entity}/template`} download={`قالب ${spec.title.replace("استيراد ", "")}.xlsx`} className={btn.secondary}>
              <Icon name="download" className="size-4" />
              تنزيل القالب (Excel)
            </a>
            <div className="mt-4 text-xs text-gray-500">الحقول المطلوبة:</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {spec.fields.filter((f) => f.required).map((f) => (
                <span key={f.key} className="rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">
                  {f.label}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-gray-500">
              الصفوف المعلّمة «احذف الصف» (المطلوب، قواعد التحقق، الأمثلة) تُتجاهل تلقائياً، فاكتب بياناتك أسفلها مباشرة. يمكنك أيضاً رفع ملف وافق أو أي ملف بأعمدة مختلفة وتربطها في الخطوة التالية.
            </p>
          </section>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition ${
              dragging ? "border-brand-500 bg-brand-50" : "border-gray-300 bg-white hover:border-brand-500/60 hover:bg-brand-50/40"
            }`}
          >
            {busy === "parse" ? (
              <>
                <Truck className="w-14" spinning />
                <span className="text-sm text-gray-600">جارٍ قراءة {fileName}…</span>
              </>
            ) : (
              <>
                <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-500 text-brand-900">
                  <Icon name="upload" className="size-6" />
                </span>
                <span className="font-semibold text-brand-900">٢. ارفع ملف Excel</span>
                <span className="text-xs text-gray-500">اسحب الملف هنا أو اضغط للاختيار (‎.xlsx أو ‎.csv)</span>
              </>
            )}
            <input ref={inputRef} type="file" accept=".xlsx,.csv" className="sr-only" disabled={pending} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </div>
      )}

      {parsed && !report && (
        <MappingStep
          spec={spec}
          parsed={parsed}
          fileName={fileName}
          mapping={mapping}
          enabled={enabled}
          setEnabled={setEnabled}
          setField={setField}
          active={active}
          fieldOf={fieldOf}
          missingRequired={missingRequired.map((f) => f.label)}
          checking={busy === "check"}
          onCheck={() => run(true)}
          onReset={reset}
        />
      )}

      {parsed && report && (
        <ReportStep
          spec={spec}
          parsed={parsed}
          report={report}
          busy={busy}
          onImport={() => run(false)}
          onRecheck={() => run(true)}
          onBack={() => setReport(null)}
          onReset={reset}
        />
      )}
    </div>
  );
}

function MappingStep({
  spec,
  parsed,
  fileName,
  mapping,
  enabled,
  setEnabled,
  setField,
  active,
  fieldOf,
  missingRequired,
  checking,
  onCheck,
  onReset,
}: {
  spec: ImportSpec;
  parsed: Parsed;
  fileName: string;
  mapping: (string | null)[];
  enabled: boolean[];
  setEnabled: (fn: (e: boolean[]) => boolean[]) => void;
  setField: (col: number, key: string | null) => void;
  active: (string | null)[];
  fieldOf: Record<string, ImportSpec["fields"][number]>;
  missingRequired: string[];
  checking: boolean;
  onCheck: () => void;
  onReset: () => void;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const sample = (c: number) => [...new Set(parsed.rows.map((r) => r[c]).filter(Boolean))].slice(0, 3);
  // أعمدة القالب التي لا بيانات فيها (كثيرة في ملفات وافق) تُطوى ما لم تكن مربوطة
  const empty = parsed.headers.map((_, c) => !mapping[c] && !parsed.rows.some((r) => r[c]));
  const hidden = empty.filter(Boolean).length;
  const previewCols = active.map((k, c) => (k ? c : -1)).filter((c) => c >= 0);
  const on = enabled.filter(Boolean).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white px-5 py-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <Icon name="document" className="size-5" />
          </span>
          <div>
            <div className="font-semibold text-brand-900">{fileName}</div>
            <div className="text-xs text-gray-500">
              <span className="ltr-nums">{parsed.rows.length}</span> صف بيانات · <span className="ltr-nums">{parsed.headers.length}</span> عمود · مفتوح للاستيراد{" "}
              <span className="ltr-nums">{on}</span>
            </div>
          </div>
        </div>
        <button type="button" onClick={onReset} className={btn.ghost}>
          تغيير الملف
        </button>
      </div>

      <section className="rounded-2xl border border-black/[0.06] bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="font-semibold text-brand-900">طابق أعمدة ملفك مع حقول النظام</h2>
          <p className="text-xs text-gray-500">طابقتها تلقائياً من أسماء الأعمدة. أغلق أي عمود لا تريد استيراد بياناته، أو غيّر الحقل المقابل له.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="w-20 px-4 py-2 text-start font-medium">استيراد</th>
                <th className="px-4 py-2 text-start font-medium">عمود الملف</th>
                <th className="px-4 py-2 text-start font-medium">عينة من البيانات</th>
                <th className="px-4 py-2 text-start font-medium">يُستورد إلى</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {parsed.headers.map((h, c) => {
                if (empty[c] && !showEmpty) return null;
                const key = mapping[c];
                const isOn = enabled[c];
                return (
                  <tr key={c} className={`transition ${isOn ? "" : "bg-gray-50/70 text-gray-400"}`}>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isOn}
                        aria-label={`استيراد عمود ${h}`}
                        disabled={!key}
                        title={key ? undefined : "اختر الحقل المقابل أولاً"}
                        onClick={() => setEnabled((en) => en.map((e, i) => (i === c ? !e : e)))}
                        className={`relative h-6 w-11 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${isOn ? "bg-brand-500" : "bg-gray-300"}`}
                      >
                        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${isOn ? "start-[1.375rem]" : "start-0.5"}`} />
                      </button>
                    </td>
                    <td className="px-4 py-2 font-medium whitespace-pre-line">{h}</td>
                    <td className="max-w-64 px-4 py-2 text-xs">
                      <span className="line-clamp-2">{sample(c).join(" · ") || "—"}</span>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={key ?? ""}
                        onChange={(e) => setField(c, e.target.value || null)}
                        className={`h-9 w-full min-w-44 rounded-lg border bg-white ps-2.5 pe-7 text-sm shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none ${
                          key ? "border-emerald-300 text-gray-800" : "border-gray-200 text-gray-400"
                        }`}
                      >
                        <option value="">— لا يُستورد —</option>
                        {spec.fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? " *" : ""}
                            {mapping.includes(f.key) && mapping[c] !== f.key ? " (مربوط بعمود آخر)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hidden > 0 && (
          <button type="button" onClick={() => setShowEmpty(!showEmpty)} className="w-full border-t border-gray-100 px-5 py-2.5 text-start text-xs text-gray-500 hover:bg-gray-50">
            {showEmpty ? "إخفاء الأعمدة الفارغة" : `إظهار ${hidden} عمود فارغ بلا بيانات`}
          </button>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="me-1 text-gray-500">الحقول المطلوبة:</span>
        {spec.fields.filter((f) => f.required).map((f) => {
          const ok = active.includes(f.key);
          return (
            <span key={f.key} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 ring-1 ${ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>
              {ok ? <Icon name="check" className="size-3.5" /> : <Icon name="close" className="size-3.5" />}
              {f.label}
            </span>
          );
        })}
      </div>

      {previewCols.length > 0 && (
        <section className="rounded-2xl border border-black/[0.06] bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-brand-900">معاينة أول الصفوف كما ستُستورد</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">الصف</th>
                  {previewCols.map((c) => (
                    <th key={c} className="px-3 py-2 text-start font-medium whitespace-nowrap">
                      {fieldOf[active[c]!].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parsed.rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td className="ltr-nums px-3 py-1.5 text-gray-400">{parsed.rowNumbers[i]}</td>
                    {previewCols.map((c) => (
                      <td key={c} className="px-3 py-1.5 whitespace-nowrap">
                        {r[c] || <span className="text-gray-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onCheck} disabled={missingRequired.length > 0 || checking} className={btn.primary}>
          {checking ? <Truck className="w-7" spinning /> : <Icon name="check" className="size-4" />}
          {checking ? "جارٍ التحقق…" : "تحقق من البيانات"}
        </button>
        {missingRequired.length > 0 && <span className="text-xs text-red-700">اربط الحقول المطلوبة أولاً: {missingRequired.join("، ")}</span>}
      </div>
    </div>
  );
}

function groupMissing(issues: ImportIssue[]) {
  const out = new Map<string, Set<string>>();
  for (const i of issues) {
    if (!i.missing) continue;
    out.set(i.missing.kind, (out.get(i.missing.kind) ?? new Set()).add(i.missing.value));
  }
  return [...out.entries()] as [keyof typeof MISSING_LABELS, Set<string>][];
}

function ReportStep({
  spec,
  parsed,
  report,
  busy,
  onImport,
  onRecheck,
  onBack,
  onReset,
}: {
  spec: ImportSpec;
  parsed: Parsed;
  report: ImportReport;
  busy: "parse" | "check" | "import" | null;
  onImport: () => void;
  onRecheck: () => void;
  onBack: () => void;
  onReset: () => void;
}) {
  const bad = report.issues.length;
  const missing = groupMissing(report.issues);

  const errorFile = () => {
    const reason = new Map<number, string>();
    for (const i of report.issues) for (const r of i.rows) reason.set(r, i.message);
    const rows = parsed.rows.flatMap((cells, i) => (reason.has(parsed.rowNumbers[i]) ? [[String(parsed.rowNumbers[i]), reason.get(parsed.rowNumbers[i])!, ...cells]] : []));
    download(`أخطاء ${spec.title}.csv`, [["رقم الصف", "سبب الخطأ", ...parsed.headers], ...rows]);
  };

  if (!report.dryRun && !report.error) {
    return (
      <section className="animate-rise rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Icon name="check" className="size-7" />
        </span>
        <h2 className="mt-3 text-lg font-semibold text-brand-900">
          تم استيراد <span className="ltr-nums">{report.ok}</span> {spec.noun}
        </h2>
        {spec.entity === "sales-invoices" && <p className="mt-1 text-sm text-gray-500">الفواتير مسودات؛ راجعها ثم أصدرها من قائمة الفواتير (يمكن تحديدها وإصدارها معاً).</p>}
        {bad > 0 && (
          <p className="mt-1 text-sm text-amber-700">
            لم يُستورد <span className="ltr-nums">{bad}</span> {spec.noun} بسبب أخطاء. نزّل تقرير الأخطاء وصححها ثم ارفعها.
          </p>
        )}
        {!!report.created?.length && (
          <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-1.5">
            {report.created.slice(0, 30).map((c) => (
              <span key={c} className="ltr-nums rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                {c}
              </span>
            ))}
            {report.created.length > 30 && <span className="text-xs text-gray-400">و{report.created.length - 30} غيرها</span>}
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href={spec.backHref} className={btn.primary}>
            عرض القائمة
          </Link>
          {bad > 0 && (
            <button type="button" onClick={errorFile} className={btn.secondary}>
              <Icon name="download" className="size-4" />
              تقرير الأخطاء
            </button>
          )}
          <button type="button" onClick={onReset} className={btn.ghost}>
            استيراد ملف آخر
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">إجمالي السجلات</div>
          <div className="ltr-nums mt-1 text-2xl font-semibold text-brand-900">{report.total}</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="text-xs text-emerald-800">جاهزة للاستيراد</div>
          <div className="ltr-nums mt-1 text-2xl font-semibold text-emerald-700">{report.ok}</div>
        </div>
        <div className={`rounded-2xl border p-4 ${bad ? "border-red-200 bg-red-50/60" : "border-black/[0.06] bg-white"}`}>
          <div className={`text-xs ${bad ? "text-red-800" : "text-gray-500"}`}>بها أخطاء</div>
          <div className={`ltr-nums mt-1 text-2xl font-semibold ${bad ? "text-red-700" : "text-gray-400"}`}>{bad}</div>
        </div>
      </div>

      {missing.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
          <h2 className="font-semibold text-amber-900">بيانات غير موجودة في النظام، أنشئها أولاً ثم أعد التحقق</h2>
          <div className="mt-3 flex flex-col gap-3">
            {missing.map(([kind, values]) => (
              <div key={kind}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-amber-900">
                    {MISSING_LABELS[kind].label} (<span className="ltr-nums">{values.size}</span>)
                  </span>
                  <Link href={MISSING_LABELS[kind].href} target="_blank" className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline">
                    {MISSING_LABELS[kind].action} ↗
                  </Link>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[...values].slice(0, 40).map((val) => (
                    <span key={val} className="rounded-md bg-white px-2 py-0.5 text-xs text-gray-700 ring-1 ring-amber-200">
                      {val}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {bad > 0 && (
        <section className="rounded-2xl border border-black/[0.06] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
            <h2 className="font-semibold text-brand-900">الصفوف التي بها أخطاء</h2>
            <button type="button" onClick={errorFile} className={btn.secondary}>
              <Icon name="download" className="size-4" />
              تنزيل تقرير الأخطاء
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="w-32 px-4 py-2 text-start font-medium">الصف في الملف</th>
                  <th className="px-4 py-2 text-start font-medium">السبب</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.issues.slice(0, 300).map((i, n) => (
                  <tr key={n}>
                    <td className="ltr-nums px-4 py-2 text-gray-500">{i.rows.length > 3 ? `${i.rows[0]}…${i.rows.at(-1)}` : i.rows.join("، ")}</td>
                    <td className="px-4 py-2 text-red-800">{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {bad === 0 && !report.error && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">كل البيانات سليمة وجاهزة للاستيراد.</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onImport} disabled={!report.ok || busy != null} className={btn.primary}>
          {busy === "import" ? <Truck className="w-7" spinning /> : <Icon name="upload" className="size-4" />}
          {busy === "import" ? "جارٍ الاستيراد…" : bad ? `استيراد السليم فقط (${report.ok})` : `استيراد ${report.ok} ${spec.noun}`}
        </button>
        <button type="button" onClick={onRecheck} disabled={busy != null} className={btn.secondary}>
          {busy === "check" ? "جارٍ التحقق…" : "أعد التحقق"}
        </button>
        <button type="button" onClick={onBack} disabled={busy != null} className={btn.ghost}>
          تعديل المطابقة
        </button>
        <button type="button" onClick={onReset} disabled={busy != null} className={btn.ghost}>
          رفع ملف آخر
        </button>
      </div>
    </div>
  );
}
