"use client";

// محرك الجولات: يضيء البند المطلوب برقمه في كل صفحة، وينتقل عند الضغط عليه أو بزر «التالي»،
// ويحفظ موضع المستخدم في المتصفح ليستكمل من حيث توقف.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { matchPath, tourById, type EntryLine, type TourTarget } from "@/data/tours";
import { Icon } from "@/components/icons";

const KEY = "alkamal-tour";
const EVENT = "alkamal-tour-change";

export interface TourState {
  id: string;
  step: number;
  paused?: boolean;
  done?: boolean;
}

function read(): TourState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TourState) : null;
  } catch {
    return null;
  }
}

function write(state: TourState | null) {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    // التخزين غير متاح (نافذة خاصة): تعمل الجولة في هذه الصفحة فقط
  }
  cached = state;
  window.dispatchEvent(new Event(EVENT));
}

let cached: TourState | null | undefined;
function subscribe(cb: () => void) {
  const onChange = () => {
    cached = read();
    cb();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
const snapshot = () => {
  if (cached === undefined) cached = read();
  return cached;
};

export const useTourState = () => useSyncExternalStore(subscribe, snapshot, () => null);

/** يبحث عن البند داخل محتوى الصفحة: أول عنصر ظاهر يطابق المحدد، أو أقصر عنصر يحوي النص. */
function resolve(target: TourTarget): HTMLElement | null {
  const root = document.querySelector("main") ?? document.body;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  let el: HTMLElement | null = null;
  if (target.css) {
    el = (Array.from(root.querySelectorAll(target.css)).find(visible) as HTMLElement | undefined) ?? null;
  } else if (target.text) {
    const matches = Array.from(root.querySelectorAll<HTMLElement>(target.tag ?? "button,a,summary,h2"))
      .filter((e) => visible(e) && (e.textContent ?? "").trim().includes(target.text!))
      .sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length);
    el = matches[0] ?? null;
  }
  if (el && target.up) el = (el.closest(target.up) as HTMLElement | null) ?? el;
  return el;
}

export function startTour(id: string, step = 0) {
  write({ id, step });
}

export function StartTourButton({ id, label = "ابدأ الجولة", step = 0, className }: { id: string; label?: string; step?: number; className?: string }) {
  const router = useRouter();
  const tour = tourById(id);
  return (
    <button
      type="button"
      className={className ?? "rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500"}
      onClick={() => {
        startTour(id, step);
        const s = tour?.steps[step];
        if (s) router.push(s.href ?? s.path);
      }}
    >
      {label}
    </button>
  );
}

function Entry({ lines }: { lines: EntryLine[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-gray-400">
          <th className="pb-1 text-start font-medium">مدين</th>
          <th className="pb-1 text-start font-medium">دائن</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className="border-t border-gray-100">
            <td className="py-1 pe-2 align-top text-gray-800">{l.side === "dr" ? l.account : ""}</td>
            <td className="py-1 ps-2 align-top text-gray-800">
              {l.side === "cr" ? l.account : ""}
              {l.note && <span className="block text-[11px] text-gray-400">{l.note}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Rect = { top: number; left: number; width: number; height: number };

export function TourRunner() {
  const state = useTourState();
  const pathname = usePathname();
  const router = useRouter();
  const tour = state && !state.paused ? tourById(state.id) : undefined;
  const step = tour && !state?.done ? tour.steps[state!.step] : undefined;
  const onPage = !!step && matchPath(step.path, pathname);
  const [found, setFound] = useState<{ key: string; rect: Rect | null; missing: boolean } | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const key = `${state?.id}:${state?.step}:${pathname}`;
  const scrolled = useRef<string>("");

  const go = useCallback(
    (delta: number) => {
      if (!tour || !state) return;
      const next = state.step + delta;
      if (next < 0) return;
      if (next >= tour.steps.length) write({ ...state, done: true });
      else write({ id: state.id, step: next });
    },
    [tour, state],
  );

  // تتبع البند: يُعاد البحث دورياً لأن المعاينات والقوائم تظهر بعد التحميل
  useEffect(() => {
    elRef.current = null;
    if (!step || !onPage || !step.target) return;
    const startedAt = Date.now();
    let frame = 0;
    const tick = () => {
      const el = resolve(step.target!);
      elRef.current = el;
      if (el) {
        if (scrolled.current !== key) {
          scrolled.current = key;
          el.scrollIntoView({ block: el.getBoundingClientRect().height > window.innerHeight * 0.6 ? "start" : "center", behavior: "smooth" });
        }
        const r = el.getBoundingClientRect();
        setFound((old) =>
          old?.key === key && old.rect && old.rect.top === r.top && old.rect.left === r.left && old.rect.width === r.width && old.rect.height === r.height
            ? old
            : { key, rect: { top: r.top, left: r.left, width: r.width, height: r.height }, missing: false },
        );
      } else {
        const missing = Date.now() - startedAt > 2500;
        setFound((old) => (old?.key === key && !old.rect && old.missing === missing ? old : { key, rect: null, missing }));
      }
    };
    tick();
    const id = window.setInterval(tick, 300);
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.clearInterval(id);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [step, onPage, key]);

  // الانتقال بالضغط على البند نفسه: يُحفظ قبل أن تنتقل الصفحة
  useEffect(() => {
    if (!step || step.advance !== "click" || !onPage) return;
    const onClick = (e: MouseEvent) => {
      const el = elRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) go(1);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [step, onPage, go]);

  if (!tour || !state) return null;
  const current = step?.target && found?.key === key ? found : null;
  const rect = current?.rect ?? null;
  const missing = !!step && onPage && (!step.target || !!current?.missing);
  const total = tour.steps.length;
  const stop = () => write({ ...state, paused: true });

  if (state.done) {
    return (
      <div data-tour-ui className="fixed inset-0 z-[90] flex items-center justify-center bg-asphalt-900/60 p-4 print:hidden">
        <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
          <div className="mb-1 flex items-center gap-2 text-brand-700">
            <Icon name="check" className="size-5" />
            <span className="text-sm font-semibold">اكتملت الجولة</span>
          </div>
          <h2 className="mb-4 font-display text-lg font-semibold text-brand-900">{tour.title}: القيود التي تكوّنت</h2>
          <div className="flex flex-col gap-3">
            {tour.entries.map((e) => (
              <div key={e.title} className="rounded-xl border border-gray-100 p-3">
                <div className="mb-1.5 text-sm font-semibold text-gray-800">{e.title}</div>
                <Entry lines={e.lines} />
              </div>
            ))}
          </div>
          {tour.note && (
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <span className="font-semibold">تنبيه المستشار المالي: </span>
              {tour.note}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" onClick={() => write({ id: tour.id, step: 0 })}>
              إعادة الجولة
            </button>
            <button
              type="button"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 hover:bg-brand-500"
              onClick={() => {
                write(null);
                router.push("/help");
              }}
            >
              إنهاء
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!step) return null;

  const counter = (
    <span className="ltr-nums text-xs text-gray-400">
      {state.step + 1} / {total}
    </span>
  );
  const controls = (
    <div className="mt-4 flex items-center gap-2">
      <button type="button" onClick={stop} className="text-xs text-gray-500 hover:text-red-600">
        إيقاف الجولة
      </button>
      <span className="ms-auto" />
      {state.step > 0 && (
        <button type="button" onClick={() => go(-1)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
          السابق
        </button>
      )}
      <button
        type="button"
        onClick={() => go(1)}
        className={
          step.advance === "click" && rect
            ? "rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            : "rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-brand-900 hover:bg-brand-500"
        }
      >
        {state.step === total - 1 ? "الختام" : step.advance === "click" && rect ? "تخطٍّ" : "التالي"}
      </button>
    </div>
  );
  const body = (
    <>
      <div className="mb-1 flex items-center gap-2">
        <span className="ltr-nums flex size-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-brand-900">{state.step + 1}</span>
        <span className="font-semibold text-brand-900">{step.title}</span>
        <span className="ms-auto">{counter}</span>
      </div>
      <p className="text-sm leading-relaxed text-gray-600">{step.body}</p>
      {step.advance === "click" && rect && <p className="mt-2 text-xs font-medium text-brand-700">اضغط على البند المضاء للمتابعة.</p>}
      {(step.accounting || step.entry) && (
        <div className="mt-3 rounded-xl bg-gray-50 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-700">
            <Icon name="ledger" className="size-3.5" />
            المحاسبة
          </div>
          {step.accounting && <p className="mb-2 text-xs leading-relaxed text-gray-600">{step.accounting}</p>}
          {step.entry && <Entry lines={step.entry} />}
        </div>
      )}
    </>
  );

  // في صفحة أخرى: بطاقة صغيرة تدعو للانتقال
  if (!onPage) {
    return (
      <div data-tour-ui className="fixed bottom-20 left-4 z-[90] md:bottom-4 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-brand-500/40 bg-white p-4 shadow-2xl print:hidden">
        <div className="mb-1 text-xs text-gray-500">{tour.title}</div>
        {body}
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={stop} className="text-xs text-gray-500 hover:text-red-600">
            إيقاف الجولة
          </button>
          <span className="ms-auto" />
          {state.step > 0 && (
            <button type="button" onClick={() => go(-1)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
              السابق
            </button>
          )}
          <button type="button" onClick={() => router.push(step.href ?? step.path)} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-brand-900 hover:bg-brand-500">
            انتقل إلى «{step.page}»
          </button>
        </div>
      </div>
    );
  }

  // البند غير ظاهر (لا بيانات بعد): الشرح في منتصف الشاشة
  if (!rect) {
    if (!missing) return null;
    return (
      <div data-tour-ui className="fixed bottom-20 left-4 z-[90] md:bottom-4 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-brand-500/40 bg-white p-4 shadow-2xl print:hidden">
        <div className="mb-1 text-xs text-gray-500">{tour.title}</div>
        {body}
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">البند غير ظاهر الآن، غالباً لأنه لا توجد بيانات بعد أو لا تملك صلاحيته. تابع بزر «التالي».</p>
        {controls}
      </div>
    );
  }

  const pad = 6;
  const box = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const cardW = Math.min(380, vw - 32);
  // تحت البند إن اتسع، وإلا فوقه، وإلا (بند أطول من الشاشة) في الركن السفلي
  const below = box.top + box.height + 12;
  const spaceBelow = vh - below - 16;
  const spaceAbove = box.top - 28;
  const offscreen = box.top > vh - 40 || box.top + box.height < 40;
  const place = offscreen ? "corner" : spaceBelow >= 300 ? "below" : spaceAbove >= 300 ? "above" : "corner";
  const cardTop = place === "below" ? below : undefined;
  const cardBottom = place === "above" ? vh - box.top + 12 : place === "corner" ? 16 : undefined;
  const cardMaxH = place === "below" ? spaceBelow : place === "above" ? spaceAbove : vh * 0.55;
  const cardLeft = place === "corner" ? 16 : Math.max(16, Math.min(box.left + box.width - cardW, vw - cardW - 16));

  return (
    <div data-tour-ui className="print:hidden">
      <div
        className="pointer-events-none fixed z-[89] rounded-xl ring-4 ring-brand-500 transition-all duration-300"
        style={{ ...box, boxShadow: "0 0 0 9999px rgba(20, 25, 30, 0.45)" }}
      />
      <span
        className="ltr-nums pointer-events-none fixed z-[90] flex size-8 items-center justify-center rounded-full bg-brand-500 font-display text-sm font-bold text-brand-900 shadow-lg ring-4 ring-white transition-all duration-300"
        style={{ top: Math.max(4, box.top - 14), left: Math.max(4, box.left + box.width - 18) }}
      >
        {state.step + 1}
      </span>
      <div
        className="fixed z-[90] overflow-y-auto rounded-2xl border border-brand-500/40 bg-white p-4 shadow-2xl transition-all duration-300"
        style={{ width: cardW, left: cardLeft, top: cardTop, bottom: cardBottom, maxHeight: cardMaxH }}
      >
        <div className="mb-1 text-xs text-gray-500">{tour.title}</div>
        {body}
        {controls}
      </div>
    </div>
  );
}
