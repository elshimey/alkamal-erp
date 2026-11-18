"use client";

import { TOUR_GROUPS, TOURS } from "@/data/tours";
import { Icon } from "@/components/icons";
import { StartTourButton, useTourState } from "@/components/tour";

// جولة لكل مهمة، مجمّعة بالأقسام، مع الاستكمال من آخر خطوة
export function TourCards() {
  const state = useTourState();
  return (
    <div className="flex flex-col gap-6">
      {TOUR_GROUPS.map((g) => (
        <section key={g}>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">{g}</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {TOURS.filter((t) => t.group === g).map((t) => {
              const paused = state?.id === t.id && state.paused && !state.done ? state.step : null;
              return (
                <div key={t.id} className="flex flex-col rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm transition hover:border-brand-500/40 hover:shadow-md">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-asphalt-900 text-brand-500">
                      <Icon name={t.icon} className="size-5" />
                    </span>
                    <span className="font-semibold text-gray-800">{t.title}</span>
                  </div>
                  <p className="mb-3 flex-1 text-xs leading-relaxed text-gray-500">{t.summary}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {paused != null ? (
                      <>
                        <StartTourButton id={t.id} step={paused} label={`استكمل من الخطوة ${paused + 1}`} />
                        <StartTourButton id={t.id} label="من البداية" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" />
                      </>
                    ) : (
                      <StartTourButton id={t.id} />
                    )}
                    <span className="ltr-nums ms-auto text-xs text-gray-400">{t.steps.length} خطوة</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
