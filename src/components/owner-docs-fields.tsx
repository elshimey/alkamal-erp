"use client";

import { useEffect, useRef, useState } from "react";
import { DateInput } from "./date-input";
import { DocumentFileInput } from "./document-file-input";

export type DocFieldState = "valid" | "soon" | "expired" | "missing" | "none";
export interface DocFieldType {
  id: number;
  nameAr: string;
  required: boolean;
  state: DocFieldState;
  stateLabel: string;
  current?: { id: number; number: string | null; issueDate: string | null; expiryDate: string | null; attachmentId: number | null };
  /** رقم معروف من بيانات الصاحب (رقم الإقامة في بيانات السائق مثلاً) */
  knownNumber?: string | null;
}

const TONE: Record<DocFieldState, string> = {
  valid: "bg-green-50 text-green-700 ring-green-600/20",
  soon: "bg-amber-50 text-amber-800 ring-amber-600/20",
  expired: "bg-red-50 text-red-700 ring-red-600/20",
  missing: "bg-red-50 text-red-700 ring-red-600/20",
  none: "bg-gray-50 text-gray-600 ring-gray-500/20",
};

const cell = "w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100";

/**
 * وثائق الصاحب داخل نافذة إضافته أو تعديله: لكل نوع الرقم والإصدار والانتهاء ومرفق.
 * تغيير تاريخ الانتهاء يسجَّل تجديداً (وثيقة جديدة وتبقى السابقة في التاريخ)، وتغيير الرقم وحده تصحيح.
 * switchName: حقل في النموذج يحدد أي مجموعة تظهر (رأس أم مقطورة).
 */
export function OwnerDocsFields({ groups, switchName }: { groups: { when?: string; types: DocFieldType[] }[]; switchName?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [when, setWhen] = useState<string | undefined>(groups[0]?.when);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!switchName) return;
    const form = box.current?.closest("form");
    if (!form) return;
    const read = () => {
      const el = form.elements.namedItem(switchName) as HTMLSelectElement | RadioNodeList | null;
      if (el?.value) setWhen(el.value);
    };
    read();
    form.addEventListener("change", read);
    form.addEventListener("reset", () => setTimeout(read));
    return () => form.removeEventListener("change", read);
  }, [switchName]);

  const group = groups.find((g) => g.when === when) ?? groups[0];
  if (!group) return null;
  const main = group.types.filter((t) => t.required || t.current);
  const optional = group.types.filter((t) => !t.required && !t.current);

  const row = (t: DocFieldType) => (
    <div key={t.id} className="grid grid-cols-2 gap-2 border-b border-gray-100 py-3 last:border-0 sm:grid-cols-[11rem_1fr_9.5rem_9.5rem_10rem] sm:items-center">
      <div className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-1">
        <span className="text-sm font-medium text-gray-800">{t.nameAr}</span>
        {t.required && <span className="text-red-600">*</span>}
        <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${TONE[t.state]}`}>{t.stateLabel}</span>
        {t.current?.attachmentId && (
          <a href={`/files/${t.current.attachmentId}`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline" title="المرفق الحالي">
            📎
          </a>
        )}
      </div>
      {t.current && <input type="hidden" name={`doc.${t.id}.current`} value={t.current.id} />}
      <label className="col-span-2 flex flex-col gap-0.5 sm:col-span-1">
        <span className="text-[11px] text-gray-500 sm:hidden">الرقم</span>
        <input name={`doc.${t.id}.number`} defaultValue={t.current?.number ?? ""} placeholder={t.knownNumber || "الرقم"} dir="ltr" className={cell} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-gray-500 sm:hidden">الإصدار</span>
        <DateInput name={`doc.${t.id}.issue`} defaultValue={t.current?.issueDate ?? ""} className={`${cell} w-full`} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-gray-500 sm:hidden">الانتهاء</span>
        <DateInput name={`doc.${t.id}.expiry`} defaultValue={t.current?.expiryDate ?? ""} className={`${cell} w-full`} />
      </label>
      <div className="col-span-2 sm:col-span-1">
        <DocumentFileInput name={`doc.${t.id}.file`} label={t.current?.attachmentId ? "استبدال المرفق" : "إرفاق صورة أو PDF"} />
      </div>
    </div>
  );

  return (
    <div ref={box}>
      <div className="hidden grid-cols-[11rem_1fr_9.5rem_9.5rem_10rem] gap-2 border-b border-gray-200 pb-2 text-xs font-medium text-gray-500 sm:grid">
        <span>الوثيقة</span>
        <span>الرقم</span>
        <span>تاريخ الإصدار</span>
        <span>تاريخ الانتهاء</span>
        <span>المرفق</span>
      </div>
      {main.map(row)}
      {optional.length > 0 && (
        <>
          <button type="button" onClick={() => setMore((m) => !m)} className="mt-2 text-sm font-medium text-brand-700 hover:underline">
            {more ? "إخفاء الوثائق الاختيارية" : `+ وثائق اختيارية أخرى (${optional.length})`}
          </button>
          {more && optional.map(row)}
        </>
      )}
      <p className="mt-3 text-xs text-gray-500">تغيير تاريخ الانتهاء يُسجَّل تجديداً وتبقى الوثيقة السابقة في التاريخ. الخانات الفارغة لا تُحفظ.</p>
    </div>
  );
}
