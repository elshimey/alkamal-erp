"use client";

import { useRef, type ReactNode } from "react";
import { Icon } from "./icons";

/**
 * زر يفتح نافذة صغيرة في وسط الشاشة فوق الصفحة (لا تقصّها الجداول)، تُغلق بزر «إلغاء» أو × أو Esc
 * أو بالضغط خارجها، وفتح نافذة أخرى يغلق السابقة تلقائياً لأن النافذة تحجب ما خلفها.
 */
export function DialogButton({
  label,
  title,
  children,
  danger = false,
  className = "",
}: {
  label: ReactNode;
  title: string;
  children: ReactNode;
  danger?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className={`rounded-lg border px-3 py-1.5 text-xs transition ${danger ? "border-red-200 text-red-700 hover:bg-red-50" : "border-gray-300 text-gray-700 hover:bg-gray-50"} ${className}`}
      >
        {label}
      </button>
      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && close()}
        className="animate-rise m-auto w-[min(30rem,calc(100%-2rem))] rounded-2xl bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-asphalt-900/50 backdrop:backdrop-blur-[2px]"
      >
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className={`font-display text-lg font-semibold ${danger ? "text-red-700" : "text-brand-900"}`}>{title}</h3>
            <button type="button" onClick={close} aria-label="إغلاق" className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
              <Icon name="close" className="size-5" />
            </button>
          </div>
          {children}
          <div className="mt-4 flex justify-end border-t border-gray-100 pt-3">
            <button type="button" onClick={close} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50">
              إلغاء
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
