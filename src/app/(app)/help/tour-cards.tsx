"use client";

import { TOURS } from "@/data/tours";
import { Icon } from "@/components/icons";
import { StartTourButton, useTourState } from "@/components/tour";

// بطاقات الدورات المستندية: لكل دورة جولة تفاعلية، مع الاستكمال من آخر خطوة
export function TourCards() {
  const state = useTourState();
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {TOURS.map((t, i) => {
        const paused = state?.id === t.id && state.paused && !state.done ? state.step : null;
        return (
          <div key={t.id} className="flex flex-col rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm transition hover:border-brand-500/40 hover:shadow-md">
            <div className="mb-2 flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-asphalt-900 text-brand-500">
                <Icon name={t.icon} className="size-5" />
              </span>
              <span className="flex-1">
                <span className="ltr-nums block text-xs text-gray-400">الدورة {i + 1}</span>
                <span className="block font-semibold text-gray-800">{t.title}</span>
              </span>
            </div>
            <p className="mb-3 flex-1 text-xs leading-relaxed text-gray-500">{t.summary}</p>
            <ol className="mb-3 flex flex-wrap gap-1">
              {t.steps.map((s, n) => (
                <li key={n} className="ltr-nums rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600" title={s.body}>
                  {n + 1}. <span dir="rtl">{s.title}</span>
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-2">
              {paused != null ? (
                <>
                  <StartTourButton id={t.id} step={paused} label={`استكمل من الخطوة ${paused + 1}`} />
                  <StartTourButton id={t.id} label="من البداية" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" />
                </>
              ) : (
                <StartTourButton id={t.id} />
              )}
              <span className="ltr-nums ms-auto text-xs text-gray-400">{t.steps.length} خطوات</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
