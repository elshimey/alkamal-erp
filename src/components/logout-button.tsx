"use client";

import { useRef } from "react";
import { Icon } from "./icons";

/** زر الخروج يسأل أولاً، ويُغلق السؤال بـ«إلغاء» أو × أو Esc أو الضغط خارجه. */
export function LogoutButton({ action }: { action: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} aria-label="خروج" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-gray-500 transition hover:bg-red-50 hover:text-red-600">
        <Icon name="logout" className="size-4" />
        <span className="hidden sm:inline">خروج</span>
      </button>
      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && close()}
        className="animate-rise m-auto w-[min(24rem,calc(100%-2rem))] rounded-2xl bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-asphalt-900/50 backdrop:backdrop-blur-[2px]"
      >
        <form action={action} className="p-5 text-start">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="font-display text-lg font-semibold text-brand-900">تسجيل الخروج</h3>
            <button type="button" onClick={close} aria-label="إغلاق" className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
              <Icon name="close" className="size-5" />
            </button>
          </div>
          <p className="text-sm text-gray-600">هل تريد الخروج من البرنامج على هذا الجهاز؟</p>
          <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button type="button" onClick={close} autoFocus className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50">
              إلغاء
            </button>
            <button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700">خروج</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
