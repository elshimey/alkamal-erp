"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import type { FormState } from "./action-form";

export type MenuAction = (data: FormData) => Promise<FormState>;

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  /** رابط بدل الإجراء */
  href?: string;
  newTab?: boolean;
  /** رابط ملف يُنزَّل (تصدير Excel/CSV) */
  download?: boolean;
  /** رابط نص يُنسخ إلى الحافظة */
  copyFrom?: string;
  action?: MenuAction;
  /** نافذة تأكيد قبل التنفيذ، وفيها حقول اختيارية (تاريخ الفاتورة مثلاً) */
  confirm?: { title: string; text?: string; submit: string; fields?: ReactNode };
  danger?: boolean;
  /** خط فاصل قبل العنصر */
  divider?: boolean;
  disabled?: string | false;
}

function toast(message: string, error = false) {
  const el = document.createElement("div");
  el.setAttribute("role", error ? "alert" : "status");
  el.textContent = message;
  el.className = `fixed bottom-20 left-1/2 z-[95] max-w-[90vw] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm whitespace-pre-line text-white shadow-xl sm:bottom-6 ${error ? "bg-red-700" : "bg-asphalt-900"}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), error ? 6000 : 3500);
}

/**
 * قائمة عمليات المستند على طريقة وافق (زر «⋮» أو زر باسم): تغيير الحالة، النسخ، الحذف، التنزيل…
 * تُغلق بالضغط خارجها أو Esc أو اختيار عنصر، والعمليات الحساسة تسأل في نافذة تأكيد لها «إلغاء».
 */
export function ActionsMenu({ items, label, className = "" }: { items: MenuItem[]; label?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<MenuItem | null>(null);
  const [pending, start] = useTransition();
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      // تنفتح لجهة فيها متسع فلا تخرج عن الشاشة، ولأعلى إن لم يتسع ما تحت الزر
      const top = r.bottom + 330 > window.innerHeight && r.top > 330 ? Math.max(8, r.top - 330) : r.bottom + 4;
      setPos(r.right - 256 >= 8 ? { top, right: window.innerWidth - r.right } : { top, left: Math.max(8, r.left) });
    };
    place();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (confirming) dialog.current?.showModal();
  }, [confirming]);

  const run = (item: MenuItem, data = new FormData()) =>
    start(async () => {
      const res = await item.action!(data);
      if (res?.error) toast(res.error, true);
      else {
        if (res?.ok) toast(res.ok);
        setConfirming(null);
        dialog.current?.close();
      }
    });

  const choose = (item: MenuItem) => {
    setOpen(false);
    if (item.disabled) return;
    if (item.copyFrom) {
      start(async () => {
        try {
          const res = await fetch(item.copyFrom!);
          if (!res.ok) throw new Error();
          await navigator.clipboard.writeText(await res.text());
          toast("نُسخت البيانات؛ الصقها في Excel");
        } catch {
          toast("تعذر النسخ إلى الحافظة", true);
        }
      });
      return;
    }
    if (!item.action) return;
    if (item.confirm) setConfirming(item);
    else run(item);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        className={
          className ||
          (label
            ? "flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60"
            : "rounded-lg border border-gray-300 bg-white p-2 text-gray-600 shadow-sm hover:bg-gray-50 disabled:opacity-60")
        }
      >
        {label ?? <Icon name="dots" className="size-4" />}
        {label && <span className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>▼</span>}
        {!label && <span className="sr-only">العمليات</span>}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            dir="rtl"
            style={{ position: "fixed", top: pos.top, left: pos.left, right: pos.right }}
            className="animate-flyout z-[80] max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-xl"
          >
            {items.map((item) => {
              const body = (
                <>
                  {item.icon && <Icon name={item.icon} className={`mt-0.5 size-4 shrink-0 ${item.danger ? "text-red-600" : "text-gray-500"}`} />}
                  <span className="min-w-0">
                    <span className="block">{item.label}</span>
                    {(item.disabled || item.hint) && <span className="block text-xs text-gray-400">{item.disabled || item.hint}</span>}
                  </span>
                </>
              );
              const cls = `flex w-full items-start gap-2.5 px-3.5 py-2 text-start transition ${item.disabled ? "cursor-not-allowed opacity-50" : item.danger ? "text-red-700 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50"}`;
              return (
                <div key={item.label} className={item.divider ? "mt-1 border-t border-gray-100 pt-1" : ""}>
                  {item.href && item.download && !item.disabled ? (
                    <a href={item.href} download role="menuitem" onClick={() => setOpen(false)} className={cls}>
                      {body}
                    </a>
                  ) : item.href && !item.disabled ? (
                    <Link href={item.href} target={item.newTab ? "_blank" : undefined} role="menuitem" onClick={() => setOpen(false)} className={cls}>
                      {body}
                    </Link>
                  ) : (
                    <button type="button" role="menuitem" disabled={!!item.disabled} onClick={() => choose(item)} className={cls}>
                      {body}
                    </button>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
      {confirming &&
        createPortal(
          <dialog
            ref={dialog}
            onClose={() => setConfirming(null)}
            onClick={(e) => e.target === dialog.current && !pending && dialog.current?.close()}
            className="animate-rise m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-asphalt-900/50 backdrop:backdrop-blur-[2px]"
          >
            <form
              className="p-5"
              onSubmit={(e) => {
                e.preventDefault();
                run(confirming, new FormData(e.currentTarget));
              }}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className={`font-display text-lg font-semibold ${confirming.danger ? "text-red-700" : "text-brand-900"}`}>{confirming.confirm!.title}</h3>
                <button type="button" onClick={() => dialog.current?.close()} aria-label="إغلاق" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                  <Icon name="close" className="size-5" />
                </button>
              </div>
              {confirming.confirm!.text && <p className="text-sm text-gray-600">{confirming.confirm!.text}</p>}
              {confirming.confirm!.fields && <div className="mt-3 space-y-3">{confirming.confirm!.fields}</div>}
              <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-3">
                <button type="button" onClick={() => dialog.current?.close()} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm disabled:opacity-60 ${confirming.danger ? "bg-red-600 text-white hover:bg-red-700" : "bg-brand-600 text-brand-900 hover:bg-brand-500"}`}
                >
                  {pending ? "جارٍ التنفيذ…" : confirming.confirm!.submit}
                </button>
              </div>
            </form>
          </dialog>,
          document.body,
        )}
    </>
  );
}
