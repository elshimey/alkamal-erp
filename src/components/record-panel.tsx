"use client";

import { MsgText } from "@/components/msg-text";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition, type KeyboardEvent as ReactKeyEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, Truck } from "./icons";
import { confirmDiscard, useUnsavedGuard } from "./unsaved-guard";
import { toast } from "./toast";

export type PanelResult = { error: string } | { ok: string; id: number; label: string };

/** رسالة النافذة المضمّنة (من داخل مستند) إلى الصفحة الأم. */
export const PANEL_MESSAGE = "record-panel";
export type PanelMessage = { source: typeof PANEL_MESSAGE; type: "saved"; id: number; label: string } | { source: typeof PANEL_MESSAGE; type: "close" };

/**
 * نافذة إضافة أو تعديل سجل واحد على طريقة وافق: تغطي الصفحة، أقسامها مطلوب واختياري،
 * و✕ تعيد للجدول. لا يُحفظ شيء إلا بزر «حفظ»، والإغلاق مع تعديلات غير محفوظة يسأل أولاً.
 * embed: مفتوحة من داخل مستند (شحنة، فاتورة…) فتبلغ الصفحة الأم بالسجل المحفوظ.
 */
export function RecordPanel({
  title,
  subtitle,
  closeHref,
  action,
  creating,
  embed,
  footer,
  savedHref,
  wide = false,
  toolbar,
  altSubmit,
  aside,
  children,
}: {
  title: string;
  subtitle?: string;
  closeHref: string;
  action: (data: FormData) => Promise<PanelResult>;
  /** إضافة جديدة: يظهر زر «حفظ وإضافة أخرى» */
  creating: boolean;
  embed?: boolean;
  /** روابط أسفل النافذة (سجل التعديلات والحذف مثلاً) */
  footer?: ReactNode;
  /** وجهة ما بعد الحفظ بدل closeHref، و{id} يُستبدل برقم السجل المحفوظ (معاينة الأمر مثلاً) */
  savedHref?: string;
  /** عرض كامل (نموذج بجانبه معاينة المستند) بدل العمود الواحد */
  wide?: boolean;
  /** أزرار إضافية في رأس النافذة بجانب «حفظ» (إخفاء المعاينة، طباعة…) */
  toolbar?: ReactNode;
  /** زر حفظ ثانٍ يرسل الحقل name=1 مع النموذج (مثل «حفظ واعتماد وإصدار فاتورة فوراً») */
  altSubmit?: { label: string; name: string };
  /** تحت الفهرس الجانبي على الكمبيوتر (مجاميع المستند مثلاً) */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // تُرسم في body: حركة دخول الصفحة (transform) تحصر العناصر الثابتة داخلها
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [secs, setSecs] = useState<SectionState[]>([]);
  const [cur, setCur] = useState(0);

  // الفهرس الجانبي: يقرأ أقسام النافذة وخاناتها، فيضع ✓ بجانب كل خانة صحيحة وكل قسم اكتمل
  const scan = useCallback(() => {
    const f = form.current;
    if (!f) return;
    f.querySelectorAll<HTMLElement>("[data-pf]").forEach((pf) => {
      const ok = fieldOk(pf);
      if (ok !== (pf.dataset.ok === "1")) pf.dataset.ok = ok ? "1" : "0";
    });
    const next = [...f.querySelectorAll<HTMLElement>("[data-panel-section]")]
      .filter((el) => el.getClientRects().length > 0)
      .map((el): SectionState => {
        const req = [...el.querySelectorAll<HTMLElement>("[data-pf][data-req]")].filter((x) => x.getClientRects().length > 0);
        const okN = req.filter((x) => x.dataset.ok === "1").length;
        const optional = el.dataset.optional === "1";
        const any = [...el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea")].some((c) => c.value.trim() !== "");
        return { title: el.dataset.panelSection ?? "", optional, done: req.length ? okN === req.length : any, note: req.length ? `${okN} من ${req.length}` : optional ? "اختياري" : "" };
      });
    setSecs((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, []);
  const rescan = useCallback(() => {
    requestAnimationFrame(scan);
    setTimeout(scan, 120);
  }, [scan]);
  useEffect(() => {
    rescan();
    // القوائم المنسدلة والتقويم تغيّر الخانات المخفية بعد الرسم؛ فحص خفيف كل ثانية يلحقها
    const t = setInterval(scan, 900);
    return () => clearInterval(t);
  }, [scan, rescan]);

  const sectionEls = () => [...(form.current?.querySelectorAll<HTMLDetailsElement>("[data-panel-section]") ?? [])].filter((el) => el.getClientRects().length > 0);
  const markCur = (i: number) => {
    setCur(i);
    sectionEls().forEach((el, k) => (el.dataset.cur = k === i ? "1" : "0"));
  };
  const onScroll = () => {
    const b = body.current;
    if (!b) return;
    const top = b.getBoundingClientRect().top + 90;
    let c = 0;
    sectionEls().forEach((el, i) => {
      if (el.getBoundingClientRect().top < top) c = i;
    });
    if (b.scrollTop + b.clientHeight >= b.scrollHeight - 4) c = Math.max(0, sectionEls().length - 1);
    if (c !== cur) markCur(c);
  };
  const goSection = (i: number) => {
    const el = sectionEls()[i];
    if (!el) return;
    el.open = true;
    markCur(i);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => el.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea")?.focus({ preventScroll: true }), 380);
    rescan();
  };

  // Enter ينقل للخانة التالية (لا يحفظ)، وCtrl+Enter يحفظ. القائمة المنسدلة المفتوحة تأخذ Enter لنفسها
  const onKey = (e: ReactKeyEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || e.defaultPrevented || e.nativeEvent.isComposing) return;
    const t = e.target as HTMLElement;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      submit(false);
      return;
    }
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement) || (t instanceof HTMLInputElement && ["checkbox", "radio", "file", "submit", "button"].includes(t.type))) return;
    if (document.querySelector("[role=listbox]")) return;
    e.preventDefault();
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=file]):not([disabled]):not([readonly]),select:not([disabled]),textarea:not([disabled])")].filter((x) => x.getClientRects().length > 0);
    const nx = all[all.indexOf(t) + 1];
    if (!nx) return submit(false);
    nx.focus();
    nx.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  useEffect(() => {
    if (done && !saving) router.replace(done, { scroll: false });
  }, [done, saving, router]);
  useUnsavedGuard(dirty && !embed);

  const post = (m: { type: "saved"; id: number; label: string } | { type: "close" }) => window.parent.postMessage({ source: PANEL_MESSAGE, ...m }, window.location.origin);

  const close = async () => {
    if (!(await confirmDiscard(dirty))) return;
    setDirty(false);
    if (embed) post({ type: "close" });
    else router.push(closeHref, { scroll: false });
  };

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    form.current?.querySelector<HTMLElement>("input:not([type=hidden]),select")?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      // Esc الذي أغلق تقويماً أو قائمة أو نافذة تأكيد (preventDefault) لا يغلق النافذة كلها
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=listbox],[data-confirm-dialog]")) void close();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });

  const submit = (again: boolean, alt?: string) => {
    const el = form.current;
    if (!el) return;
    if (!el.reportValidity()) return;
    const data = new FormData(el);
    if (alt) data.set(alt, "1");
    setError(undefined);
    start(async () => {
      const res = await action(data);
      if ("error" in res) {
        setError(res.error);
        body.current?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setDirty(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
      if (embed) return post({ type: "saved", id: res.id, label: res.label });
      toast(res.ok);
      if (again) {
        el.reset();
        body.current?.scrollTo({ top: 0 });
        el.querySelector<HTMLElement>("input:not([type=hidden]),select")?.focus();
        rescan();
      } else {
        // يُغلق بعد انتهاء انتقال الإجراء (انظر التأثير أدناه)، وإلا غلبه تحديث الصفحة الحالية بعد الحفظ
        setDone(savedHref ? savedHref.replace("{id}", String(res.id)) : closeHref);
      }
    });
  };

  const rail = secs.length >= 2;
  const reqAll = secs.filter((x) => !x.optional).length;
  const reqDone = secs.filter((x) => !x.optional && x.done).length;

  if (!mounted) return null;
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-[70] flex flex-col bg-[#f7f6f3]" role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex items-center gap-3 border-b border-black/[0.06] bg-white px-4 py-3 shadow-sm sm:px-6">
        <button type="button" onClick={close} aria-label="إغلاق" title="إغلاق (Esc)" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
          <Icon name="close" className="size-5" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
        </div>
        {(dirty || justSaved) && (
          <span
            key={dirty ? "dirty" : "saved"}
            role="status"
            title={dirty ? "تعديلات لم تُحفظ" : "حُفظت"}
            className={`saved-pop ms-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${dirty ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}
          >
            {dirty ? <span className="size-1.5 animate-pulse rounded-full bg-amber-500" /> : <span className="ok-pop grid size-4 place-items-center rounded-full bg-emerald-600 text-white"><Icon name="check" className="size-3" /></span>}
            <span className="hidden sm:inline">{dirty ? "تعديلات لم تُحفظ" : "حُفظت"}</span>
          </span>
        )}
        <div className="ms-auto flex items-center gap-2">
          {toolbar}
          {creating && !embed && (
            <button type="button" disabled={saving} onClick={() => submit(true)} className="hidden rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60 sm:block">
              حفظ وإضافة أخرى
            </button>
          )}
          {altSubmit && (
            <button type="button" disabled={saving} onClick={() => submit(false, altSubmit.name)} className="rounded-lg border border-brand-600 bg-white px-3 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-50 disabled:opacity-60">
              {altSubmit.label}
            </button>
          )}
          <button type="button" disabled={saving} onClick={() => submit(false)} className="min-w-20 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500 disabled:opacity-70">
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <Truck className="w-7" spinning />
                جارٍ الحفظ…
              </span>
            ) : (
              "حفظ"
            )}
          </button>
        </div>
      </header>
      <div ref={body} onScroll={onScroll} className="flex-1 overflow-y-auto scroll-smooth">
        {rail && (
          <nav aria-label="أقسام النافذة" className={`sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b border-black/[0.06] bg-[#f7f6f3]/95 px-4 py-2 backdrop-blur [scrollbar-width:none] ${wide ? "2xl:hidden" : "lg:hidden"}`}>
            {secs.map((x, i) => (
              <button key={x.title} type="button" onClick={() => goSection(i)} aria-current={i === cur || undefined} className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${i === cur ? "bg-white font-semibold text-gray-900 shadow-sm" : "text-gray-600"}`}>
                <SecDot done={x.done && !x.optional} n={i + 1} cur={i === cur} />
                {x.title}
              </button>
            ))}
          </nav>
        )}
        <div className={`mx-auto flex w-full gap-6 px-4 sm:px-6 ${wide ? "max-w-[120rem]" : rail ? "max-w-[76rem]" : "max-w-4xl"}`}>
          {rail && (
            <nav aria-label="فهرس الأقسام" className={`sticky top-0 hidden w-56 shrink-0 flex-col gap-1 self-start py-6 ${wide ? "2xl:flex" : "lg:flex"}`}>
              <div className="mb-2 px-2 text-xs text-gray-500">
                اكتمل {reqDone} من {reqAll} أقسام مطلوبة
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200">
                  <i className="block h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${reqAll ? (reqDone / reqAll) * 100 : 100}%` }} />
                </div>
              </div>
              {secs.map((x, i) => (
                <button
                  key={x.title}
                  type="button"
                  onClick={() => goSection(i)}
                  aria-current={i === cur || undefined}
                  className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-sm transition-all ${i === cur ? "bg-white font-semibold text-gray-900 shadow-sm" : "text-gray-600 hover:bg-white/60"}`}
                >
                  <SecDot done={x.done && !x.optional} n={i + 1} cur={i === cur} />
                  <span className="min-w-0 flex-1 truncate">{x.title}</span>
                  {x.note && <span className="text-[11px] font-normal text-gray-400">{x.note}</span>}
                </button>
              ))}
              {aside && <div className="mt-3">{aside}</div>}
            </nav>
          )}
        <form
          ref={form}
          noValidate={false}
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
          onKeyDown={onKey}
          onFocus={(e) => {
            const i = sectionEls().findIndex((el) => el.contains(e.target as Node));
            if (i >= 0 && i !== cur) markCur(i);
          }}
          onInput={() => {
            setDirty(true);
            rescan();
          }}
          onChange={() => {
            setDirty(true);
            rescan();
          }}
          onClick={rescan}
          className="@container min-w-0 flex-1 py-6"
        >
          {error && (
            <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm whitespace-pre-line text-red-800">
              <MsgText text={error} />
            </p>
          )}
          {children}
          {footer && <div className="mt-2 flex flex-wrap gap-4 text-sm">{footer}</div>}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type SectionState = { title: string; optional: boolean; done: boolean; note: string };

/** الخانة صحيحة: فيها قيمة وكل ضوابطها سليمة (القائمة المنسدلة تحفظ قيمتها في خانة مخفية). */
function fieldOk(pf: HTMLElement) {
  const ctrls = [...pf.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")].filter((c) => !["file", "button", "submit"].includes(c.type));
  const boxes = ctrls.filter((c) => c.type === "checkbox" || c.type === "radio") as HTMLInputElement[];
  if (boxes.length === ctrls.length && boxes.length) return boxes.some((b) => b.checked);
  const vals = ctrls.filter((c) => c.type !== "checkbox" && c.type !== "radio");
  return vals.some((c) => c.value.trim() !== "" && c.value !== "[]") && vals.every((c) => c.checkValidity());
}

/** رقم القسم في الفهرس، يصير ✓ خضراء حين يكتمل. */
function SecDot({ done, n, cur }: { done: boolean; n: number; cur: boolean }) {
  return (
    <span className={`grid size-5 shrink-0 place-items-center rounded-full border-2 text-[10px] font-bold transition-all duration-300 ${done ? "ok-pop border-emerald-600 bg-emerald-600 text-white" : cur ? "border-brand-600 text-gray-900" : "border-gray-300 text-gray-500"}`}>
      {done ? <Icon name="check" className="size-3" /> : n}
    </span>
  );
}

/** رابط داخل النافذة لا يسأل عن التعديلات (يفتح صفحة أخرى بعد تأكيد النافذة نفسها). */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-brand-700 hover:underline">
      {children}
    </Link>
  );
}
