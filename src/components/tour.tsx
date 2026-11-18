"use client";

// محرك الجولات: يضيء البند المطلوب في الصفحة أو داخل النافذة المفتوحة، وينتظر المستخدم:
// يضغط البند (click)، أو يملأ الخانة فتنتقل وحدها (fill)، أو يضغط «التالي» (next).
// «أعرف هذا» يقفز للقسم التالي، و× أو Esc يوقف الجولة في أي وقت، ويُستكمل لاحقاً من نفس الخطوة.
// السرعة: لا انتظار ثابت؛ يراقب تغيّر الصفحة لحظياً، ويجهّز الصفحة التالية مسبقاً.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { matchPath, tourById, toursForPath, type EntryLine, type TourStep, type TourTarget } from "@/data/tours";
import { Icon } from "@/components/icons";
import { tourEntries, type TourEntry } from "@/lib/tour-entries";

const KEY = "alkamal-tour";
const EVENT = "alkamal-tour-change";

export interface TourState {
  id: string;
  step: number;
  /** بداية الجولة (لعرض القيود التي تكوّنت فعلاً في الختام) */
  since?: string;
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

let cached: TourState | null | undefined;
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

function subscribe(cb: () => void) {
  const onChange = () => {
    cached = read();
    cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onChange);
  };
}
const snapshot = () => {
  if (cached === undefined) cached = read();
  return cached;
};

export const useTourState = () => useSyncExternalStore(subscribe, snapshot, () => null);

/** النافذة المفتوحة في الأعلى (نافذة الإضافة أو مربع حوار)، وإلا محتوى الصفحة. */
function topLayer(): HTMLElement {
  const layers = Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]')).filter((e) => !e.closest("[data-tour-ui]"));
  return layers.pop() ?? document.querySelector("main") ?? document.body;
}

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const clean = (s: string | null | undefined) => (s ?? "").replace(/[*\s]+/g, " ").trim();

/** يبحث عن البند داخل الطبقة الظاهرة: خانة بعنوانها، أو قسم، أو محدد CSS، أو أقصر عنصر يحوي النص. */
export function resolveTarget(target: TourTarget, root: ParentNode = topLayer()): HTMLElement | null {
  let el: HTMLElement | null = null;
  if (target.field) {
    const labels = Array.from(root.querySelectorAll<HTMLElement>("label")).filter((l) => visible(l) && !l.closest("[data-tour-ui]"));
    const head = (l: HTMLElement) => clean(l.querySelector("span")?.firstChild?.textContent ?? l.querySelector("span")?.textContent ?? l.textContent);
    el = labels.find((l) => head(l) === target.field) ?? labels.find((l) => head(l).startsWith(target.field!)) ?? null;
  } else if (target.section) {
    const sums = Array.from(root.querySelectorAll<HTMLElement>("summary")).filter(visible);
    const s = sums.find((e) => clean(e.querySelector("span")?.textContent) === target.section) ?? sums.find((e) => clean(e.textContent).includes(target.section!));
    el = (s?.closest("details") as HTMLElement | null) ?? null;
  } else if (target.css) {
    el = (Array.from(root.querySelectorAll(target.css)).find((e) => visible(e) && !e.closest("[data-tour-ui]")) as HTMLElement | undefined) ?? null;
  } else if (target.text) {
    const matches = Array.from(root.querySelectorAll<HTMLElement>(target.tag ?? "button,a,summary,h2"))
      .filter((e) => visible(e) && !e.closest("[data-tour-ui]") && clean(e.textContent).includes(target.text!))
      .sort((a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length);
    el = matches[0] ?? null;
  }
  // القوائم المنسدلة تُرسم خارج النافذة (في آخر الصفحة)
  if (!el && root !== document.body && target.tag?.includes("menuitem")) return resolveTarget(target, document.body);
  if (el && target.up) el = (el.closest(target.up) as HTMLElement | null) ?? el;
  return el;
}

/** قيمة الخانة كما يراها المستخدم: نص أو اختيار أو ملف أو علامة. */
function valueOf(el: HTMLElement): string {
  return Array.from(el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea"))
    .map((i) => (i instanceof HTMLInputElement && (i.type === "checkbox" || i.type === "radio") ? String(i.checked) : i instanceof HTMLInputElement && i.type === "file" ? String(i.files?.length ?? 0) : i.value.trim()))
    .join("|");
}
const isEmpty = (v: string) => v.split("|").every((p) => p === "" || p === "false" || p === "0");

export function startTour(id: string, step = 0) {
  write({ id, step, since: new Date().toISOString() });
}

/** يبدأ الجولة من الخطوة المطلوبة، وينتقل لصفحتها إن لم يكن فيها. */
function useStart() {
  const router = useRouter();
  const pathname = usePathname();
  return (id: string, step = 0) => {
    startTour(id, step);
    const s = tourById(id)?.steps[step];
    if (s && !matchPath(s.path, pathname)) router.push(s.href ?? s.path);
  };
}

export function StartTourButton({ id, label = "ابدأ الجولة", step = 0, className }: { id: string; label?: string; step?: number; className?: string }) {
  const start = useStart();
  return (
    <button
      type="button"
      className={className ?? "rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-900 shadow-sm transition hover:bg-brand-500"}
      onClick={() => start(id, step)}
    >
      {label}
    </button>
  );
}

/** زر «كيف أعمل هذا؟» أعلى كل شاشة: يبدأ جولة الشاشة الحالية من خطوتها هنا. */
export function TourHelpButton() {
  const pathname = usePathname();
  const start = useStart();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = toursForPath(pathname);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!list.length) return null;
  const go = (t: (typeof list)[number]) => {
    setOpen(false);
    start(t.tour.id, t.step);
  };
  return (
    <div ref={box} className="relative print:hidden">
      <button
        type="button"
        onClick={() => (list.length === 1 ? go(list[0]) : setOpen((o) => !o))}
        aria-haspopup={list.length > 1 ? "menu" : undefined}
        aria-expanded={list.length > 1 ? open : undefined}
        title="جولة تشرح هذه الشاشة خطوة بخطوة"
        className="flex items-center gap-1.5 rounded-full border border-brand-600/40 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-900 transition hover:bg-brand-100"
      >
        <span className="flex size-4 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold">؟</span>
        <span className="hidden sm:inline">كيف أعمل هذا؟</span>
      </button>
      {open && (
        <div role="menu" className="absolute end-0 top-full z-40 mt-2 w-72 rounded-xl border border-black/10 bg-white p-1.5 shadow-xl">
          {list.map((t) => (
            <button key={t.tour.id} type="button" role="menuitem" onClick={() => go(t)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-gray-700 hover:bg-brand-50">
              <Icon name={t.tour.icon} className="size-4 shrink-0 text-brand-700" />
              {t.tour.title}
            </button>
          ))}
        </div>
      )}
    </div>
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
const sameRect = (a: Rect | null, b: Rect | null) => !!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
/** المهلة قبل أن نقول إن البند غير ظاهر (الصفحة غالباً تظهر في أقل منها) */
const MISSING_AFTER = 1200;
/** بعد آخر حرف في الخانة: ننتظر قليلاً حتى لا ننتقل والمستخدم يكتب */
const FILL_IDLE = 1300;

export function TourRunner() {
  const state = useTourState();
  const pathname = usePathname();
  const router = useRouter();
  const tour = state && !state.paused ? tourById(state.id) : undefined;
  const step: TourStep | undefined = tour && !state?.done ? tour.steps[state!.step] : undefined;
  const onPage = !!step && matchPath(step.path, pathname);
  const key = `${state?.id}:${state?.step}:${pathname}`;
  const [found, setFound] = useState<{ key: string; rect: Rect | null; missing: boolean; layer: HTMLElement | null; prefilled?: boolean } | null>(null);
  const [showEntry, setShowEntry] = useState(false);
  const elRef = useRef<HTMLElement | null>(null);
  const scrolled = useRef("");
  const initial = useRef<{ key: string; value: string } | null>(null);
  const lastInput = useRef(0);

  const goTo = useCallback(
    (next: number) => {
      if (!tour || !state) return;
      if (next < 0) return;
      setShowEntry(false);
      if (next >= tour.steps.length) return write({ ...state, done: true });
      write({ id: state.id, step: next, since: state.since });
      const s = tour.steps[next];
      // الخطوة التالية في صفحة أخرى: ننتقل فوراً دون بطاقة «انتقل»
      if (!matchPath(s.path, window.location.pathname)) router.push(s.href ?? s.path);
    },
    [tour, state, router],
  );
  const go = useCallback((delta: number) => state && goTo(state.step + delta), [state, goTo]);
  const pause = useCallback(() => state && write({ ...state, paused: true }), [state]);

  /** «أعرف هذا»: أول خطوة بعد القسم الحالي */
  const skipGroup = useCallback(() => {
    if (!tour || !state || !step?.group) return go(1);
    let n = state.step + 1;
    while (n < tour.steps.length && tour.steps[n].group === step.group) n++;
    goTo(n);
  }, [tour, state, step, go, goTo]);

  // تجهيز صفحة الخطوة التالية مسبقاً، فيكون الانتقال فورياً
  useEffect(() => {
    if (!tour || !state) return;
    const nextStep = tour.steps[state.step + 1];
    if (nextStep && !nextStep.path.includes("[")) router.prefetch(nextStep.href ?? nextStep.path);
  }, [tour, state, router]);

  // تتبع البند لحظياً: عند أي تغيّر في الصفحة أو تمرير أو تغيّر مقاس
  useEffect(() => {
    elRef.current = null;
    if (!step || !onPage || !step.target) return;
    const startedAt = Date.now();
    let frame = 0;
    let missTimer = 0;
    const tick = () => {
      frame = 0;
      const el = resolveTarget(step.target!);
      elRef.current = el;
      if (el) {
        if (scrolled.current !== key) {
          scrolled.current = key;
          const r0 = el.getBoundingClientRect();
          if (r0.top < 70 || r0.bottom > window.innerHeight - 20) el.scrollIntoView({ block: r0.height > window.innerHeight * 0.6 ? "start" : "center", behavior: "instant" });
        }
        if (initial.current?.key !== key) initial.current = { key, value: valueOf(el) };
        const r = el.getBoundingClientRect();
        const rect = { top: r.top, left: r.left, width: r.width, height: r.height };
        const layer = el.closest<HTMLElement>("dialog[open]");
        const prefilled = !isEmpty(initial.current.value);
        setFound((old) => (old?.key === key && sameRect(old.rect, rect) && old.layer === layer && old.prefilled === prefilled ? old : { key, rect, missing: false, layer, prefilled }));
      } else {
        const missing = Date.now() - startedAt > MISSING_AFTER;
        setFound((old) => (old?.key === key && !old.rect && old.missing === missing ? old : { key, rect: null, missing, layer: null }));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    tick();
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "class", "style", "hidden"] });
    missTimer = window.setTimeout(schedule, MISSING_AFTER + 50);
    // احتياط للحركات (فتح قسم أو نافذة) التي لا تغيّر الصفحة
    const slow = window.setInterval(schedule, 500);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      obs.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(missTimer);
      window.clearInterval(slow);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [step, onPage, key]);

  // الانتقال بالضغط على البند نفسه: يُحفظ قبل أن تنتقل الصفحة
  useEffect(() => {
    if (!step || step.advance !== "click" || !onPage) return;
    const onClick = (e: MouseEvent) => {
      const el = elRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) {
        const s = state!;
        setShowEntry(false);
        // الصفحة ستنتقل بالرابط نفسه، فلا ننتقل نحن
        if (s.step + 1 >= tour!.steps.length) write({ ...s, done: true });
        else write({ id: s.id, step: s.step + 1, since: s.since });
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [step, onPage, state, tour]);

  // الخانة: تنتقل الجولة وحدها حين يملؤها المستخدم ويتوقف عن الكتابة أو يغادرها
  useEffect(() => {
    if (!step || step.advance !== "fill" || !onPage) return;
    const onInput = (e: Event) => {
      if (elRef.current && e.target instanceof Node && elRef.current.contains(e.target)) lastInput.current = Date.now();
    };
    const check = () => {
      const el = elRef.current;
      if (!el || initial.current?.key !== key) return;
      const v = valueOf(el);
      if (isEmpty(v) || v === initial.current.value) return;
      const focused = el.contains(document.activeElement);
      // قائمة الاختيار ما زالت مفتوحة: ننتظر الاختيار
      if (document.querySelector('[role="listbox"]') && focused) return;
      if (!focused || Date.now() - lastInput.current > FILL_IDLE) go(1);
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    const id = window.setInterval(check, 250);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
      window.clearInterval(id);
    };
  }, [step, onPage, key, go]);

  // Esc يوقف الجولة، إلا إذا كانت نافذة مفتوحة (Esc يغلقها هي أولاً)
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="listbox"], [role="menu"]')) return;
      pause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour, pause]);

  if (!tour || !state) return null;
  if (state.done) return <TourDone tour={tour} state={state} />;
  if (!step) return null;

  const current = step.target && found?.key === key ? found : null;
  const rect = current?.rect ?? null;
  const total = tour.steps.length;
  const last = state.step === total - 1;
  const waiting = step.advance === "click" || step.advance === "fill";
  const prefilled = step.advance === "fill" && !!current?.prefilled;

  const closeBtn = (
    <button type="button" onClick={pause} aria-label="إيقاف الجولة" title="إيقاف الجولة (Esc)" className="rounded-md p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
      <Icon name="close" className="size-4" />
    </button>
  );
  const progress = (
    <div className="mb-2 h-1 overflow-hidden rounded-full bg-gray-100">
      <div className="h-full rounded-full bg-brand-500 transition-[width] duration-200" style={{ width: `${((state.step + 1) / total) * 100}%` }} />
    </div>
  );
  const head = (
    <>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="truncate text-xs text-gray-500">{tour.title}</span>
        <span className="ltr-nums ms-auto shrink-0 text-xs text-gray-400">
          {state.step + 1} / {total}
        </span>
        {closeBtn}
      </div>
      {progress}
      <div className="mb-1 flex items-center gap-2">
        <span className="ltr-nums flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-brand-900">{state.step + 1}</span>
        <span className="font-semibold text-brand-900">{step.title}</span>
      </div>
      <p className="text-sm leading-relaxed text-gray-600">{step.body}</p>
      {rect && step.advance === "click" && <p className="mt-2 text-xs font-medium text-brand-700">اضغط على البند المضاء للمتابعة.</p>}
      {rect && step.advance === "fill" && (
        <p className="mt-2 text-xs font-medium text-brand-700">{prefilled ? "الخانة معبأة مسبقاً: غيّرها إن لزم ثم اضغط «التالي»." : "اكتب أو اختر في الخانة المضاءة، وتنتقل الجولة وحدها."}</p>
      )}
      {(step.accounting || step.entry) && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowEntry((s) => !s)} className="flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-brand-700" aria-expanded={showEntry}>
            <Icon name="ledger" className="size-3.5" />
            {showEntry ? "إخفاء القيد" : "اعرض القيد"}
          </button>
          {showEntry && (
            <div className="mt-1.5 rounded-xl bg-gray-50 p-3">
              {step.accounting && <p className="mb-2 text-xs leading-relaxed text-gray-600">{step.accounting}</p>}
              {step.entry && <Entry lines={step.entry} />}
            </div>
          )}
        </div>
      )}
    </>
  );
  const controls = (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {step.group && (
        <button type="button" onClick={skipGroup} className="text-xs text-gray-500 underline-offset-2 hover:text-brand-700 hover:underline">
          أعرف هذا
        </button>
      )}
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
          waiting && rect && !prefilled
            ? "rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            : "rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-brand-900 hover:bg-brand-500"
        }
      >
        {last ? "الختام" : waiting && rect && (step.optional || step.advance === "click") ? "تخطٍّ" : "التالي"}
      </button>
    </div>
  );

  const corner = (extra?: React.ReactNode) => (
    <Portal layer={null}>
      <div data-tour-ui role="dialog" aria-label={tour.title} className="animate-fade-in fixed bottom-20 left-4 z-[95] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-brand-500/40 bg-white p-4 shadow-2xl md:bottom-4 print:hidden">
        {head}
        {extra}
        {controls}
      </div>
    </Portal>
  );

  // في صفحة أخرى (ابتعد المستخدم عن الجولة): زر يعيده
  if (!onPage) {
    return corner(
      <button type="button" onClick={() => router.push(step.href ?? step.path)} className="mt-3 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 hover:bg-brand-500">
        عُد إلى «{step.page}»
      </button>,
    );
  }

  // بلا بند (شرح عام) أو البند غير ظاهر بعد
  if (!rect) {
    if (step.target && !current?.missing) return null;
    const canOpen = step.href && step.href !== window.location.pathname + window.location.search;
    return corner(
      step.target ? (
        <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          {step.missing ?? "البند غير ظاهر الآن، غالباً لأن النافذة مغلقة أو لا توجد بيانات بعد أو لا تملك صلاحيته."}
          {canOpen && (
            <button type="button" onClick={() => router.push(step.href!)} className="ms-1 font-semibold underline underline-offset-2">
              افتح «{step.page}»
            </button>
          )}
        </div>
      ) : null,
    );
  }

  const pad = 5;
  const box = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const cardW = Math.min(360, vw - 24);
  // البطاقة بجانب البند إن اتسع، وإلا تحته أو فوقه، وإلا في الركن
  const spaceBelow = vh - (box.top + box.height) - 16;
  const spaceAbove = box.top - 16;
  const spaceLeft = box.left - 16;
  const spaceRight = vw - (box.left + box.width) - 16;
  const offscreen = box.top > vh - 40 || box.top + box.height < 40;
  const place = offscreen
    ? "corner"
    : spaceLeft >= cardW + 12 && box.height < vh * 0.7
      ? "left"
      : spaceRight >= cardW + 12 && box.height < vh * 0.7
        ? "right"
        : spaceBelow >= 260
          ? "below"
          : spaceAbove >= 260
            ? "above"
            : "corner";
  const side = place === "left" || place === "right";
  const style: React.CSSProperties = { width: cardW };
  if (side) {
    style.left = place === "left" ? box.left - cardW - 12 : box.left + box.width + 12;
    style.top = Math.max(12, Math.min(box.top, vh - 340));
    style.maxHeight = vh - (style.top as number) - 12;
  } else if (place === "below" || place === "above") {
    style.left = Math.max(12, Math.min(box.left + box.width - cardW, vw - cardW - 12));
    if (place === "below") {
      style.top = box.top + box.height + 12;
      style.maxHeight = spaceBelow;
    } else {
      style.bottom = vh - box.top + 12;
      style.maxHeight = spaceAbove;
    }
  } else {
    style.left = 12;
    style.bottom = 12;
    style.maxHeight = vh * 0.5;
  }

  return (
    <Portal layer={current?.layer ?? null}>
      <div data-tour-ui className="print:hidden">
        <div className="pointer-events-none fixed z-[94] rounded-xl ring-4 ring-brand-500 transition-all duration-150" style={{ ...box, boxShadow: "0 0 0 9999px rgba(20, 25, 30, 0.35)" }} />
        <div role="dialog" aria-label={tour.title} className="fixed z-[95] overflow-y-auto rounded-2xl border border-brand-500/40 bg-white p-4 shadow-2xl transition-[top,left,bottom] duration-150" style={style}>
          {head}
          {controls}
        </div>
      </div>
    </Portal>
  );
}

/** الواجهة فوق كل شيء: داخل مربع الحوار المفتوح إن وُجد (الطبقة العليا للمتصفح)، وإلا في الصفحة. */
function Portal({ layer, children }: { layer: HTMLElement | null; children: React.ReactNode }) {
  // يُرسم في المتصفح فقط (حالة الجولة من التخزين المحلي، فلا شيء على الخادم)
  if (typeof document === "undefined") return null;
  return createPortal(children, layer ?? document.querySelector<HTMLElement>("dialog[open]") ?? document.body);
}

/** الختام: القيود التي تكوّنت فعلاً أثناء الجولة، وإلا القيود المتوقعة للدورة. */
function TourDone({ tour, state }: { tour: NonNullable<ReturnType<typeof tourById>>; state: TourState }) {
  const router = useRouter();
  const [actual, setActual] = useState<TourEntry[] | null>(state.since ? null : []);
  useEffect(() => {
    let live = true;
    if (state.since) tourEntries(state.since).then((r) => live && setActual(r), () => live && setActual([]));
    return () => {
      live = false;
    };
  }, [state.since]);
  const finish = (to: string) => {
    write(null);
    router.push(to);
  };
  return (
    <div data-tour-ui className="animate-fade-in fixed inset-0 z-[95] flex items-center justify-center bg-asphalt-900/60 p-4 print:hidden" onClick={(e) => e.target === e.currentTarget && write(null)}>
      <div role="dialog" aria-label="اكتملت الجولة" className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-center gap-2 text-brand-700">
          <Icon name="check" className="size-5" />
          <span className="text-sm font-semibold">اكتملت الجولة</span>
          <button type="button" onClick={() => write(null)} aria-label="إغلاق" className="ms-auto rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <Icon name="close" className="size-4" />
          </button>
        </div>
        <h2 className="mb-4 font-display text-lg font-semibold text-brand-900">{tour.title}</h2>
        {actual && actual.length > 0 ? (
          <>
            <p className="mb-2 text-sm text-gray-600">القيود التي تكوّنت أثناء الجولة:</p>
            <div className="flex flex-col gap-3">
              {actual.map((e) => (
                <a key={e.id} href={`/journal/${e.id}`} className="rounded-xl border border-gray-100 p-3 transition hover:border-brand-500/40">
                  <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <span className="ltr-nums">{e.number}</span>
                    <span className="truncate font-normal text-gray-500">{e.memo}</span>
                    <span className="ms-auto text-xs font-normal text-gray-400">{e.status === "posted" ? "مرحّل" : "مسودة"}</span>
                  </div>
                  <Entry lines={e.lines} />
                </a>
              ))}
            </div>
          </>
        ) : tour.entries.length ? (
          <>
            <p className="mb-2 text-sm text-gray-600">{actual ? "لم يتكوّن قيد أثناء الجولة. هذه القيود التي تتكوّن في هذه الدورة:" : "جارٍ جلب القيود…"}</p>
            <div className="flex flex-col gap-3">
              {tour.entries.map((e) => (
                <div key={e.title} className="rounded-xl border border-gray-100 p-3">
                  <div className="mb-1.5 text-sm font-semibold text-gray-800">{e.title}</div>
                  <Entry lines={e.lines} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-600">هذه الدورة لا تُنشئ قيداً محاسبياً.</p>
        )}
        {tour.note && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{tour.note}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" onClick={() => startTour(tour.id)}>
            إعادة الجولة
          </button>
          <button type="button" className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" onClick={() => finish("/help")}>
            جولة أخرى
          </button>
          <button type="button" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 hover:bg-brand-500" onClick={() => write(null)}>
            إنهاء
          </button>
        </div>
      </div>
    </div>
  );
}
