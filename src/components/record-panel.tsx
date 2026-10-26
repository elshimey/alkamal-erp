"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, Truck } from "./icons";
import { confirmDiscard, useUnsavedGuard } from "./unsaved-guard";

export type PanelResult = { error: string } | { ok: string; id: number; label: string };

/** رسالة النافذة المضمّنة (من داخل مستند) إلى الصفحة الأم. */
export const PANEL_MESSAGE = "record-panel";
export type PanelMessage = { source: typeof PANEL_MESSAGE; type: "saved"; id: number; label: string } | { source: typeof PANEL_MESSAGE; type: "close" };

function toast(message: string) {
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.textContent = message;
  el.className = "fixed bottom-20 left-1/2 z-[95] -translate-x-1/2 rounded-xl bg-asphalt-900 px-4 py-2.5 text-sm text-white shadow-xl sm:bottom-6";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

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
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done && !saving) router.replace(closeHref, { scroll: false });
  }, [done, saving, router, closeHref]);
  useUnsavedGuard(dirty && !embed);

  const post = (m: { type: "saved"; id: number; label: string } | { type: "close" }) => window.parent.postMessage({ source: PANEL_MESSAGE, ...m }, window.location.origin);

  const close = () => {
    if (!confirmDiscard(dirty)) return;
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
      if (e.key === "Escape" && !document.querySelector("[role=listbox]")) close();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });

  const submit = (again: boolean) => {
    const el = form.current;
    if (!el) return;
    if (!el.reportValidity()) return;
    const data = new FormData(el);
    setError(undefined);
    start(async () => {
      const res = await action(data);
      if ("error" in res) {
        setError(res.error);
        body.current?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setDirty(false);
      if (embed) return post({ type: "saved", id: res.id, label: res.label });
      toast(res.ok);
      if (again) {
        el.reset();
        body.current?.scrollTo({ top: 0 });
        el.querySelector<HTMLElement>("input:not([type=hidden]),select")?.focus();
      } else {
        // يُغلق بعد انتهاء انتقال الإجراء (انظر التأثير أدناه)، وإلا غلبه تحديث الصفحة الحالية بعد الحفظ
        setDone(true);
      }
    });
  };

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
        <span className={`ms-2 hidden text-xs sm:inline ${dirty ? "font-semibold text-amber-700" : "text-gray-400"}`}>{dirty ? "تعديلات لم تُحفظ" : ""}</span>
        <div className="ms-auto flex items-center gap-2">
          {creating && !embed && (
            <button type="button" disabled={saving} onClick={() => submit(true)} className="hidden rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60 sm:block">
              حفظ وإضافة أخرى
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
      <div ref={body} className="flex-1 overflow-y-auto">
        <form
          ref={form}
          noValidate={false}
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
          onInput={() => setDirty(true)}
          onChange={() => setDirty(true)}
          className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6"
        >
          {error && (
            <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm whitespace-pre-line text-red-800">
              {error}
            </p>
          )}
          {children}
          {footer && <div className="mt-2 flex flex-wrap gap-4 text-sm">{footer}</div>}
          {/* Enter في حقل نصي يحفظ */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      </div>
    </div>,
    document.body,
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
