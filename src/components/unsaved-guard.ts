"use client";

import { useEffect } from "react";

export const UNSAVED_MESSAGE = "لديك تغييرات لم تُحفظ. هل تريد المغادرة وتجاهلها؟";

/**
 * يمنع ضياع التعديلات غير المحفوظة: يسأل قبل الانتقال من أي رابط في الصفحة
 * (القائمة الجانبية، زر العودة، المسار)، وقبل إغلاق المتصفح أو تحديث الصفحة.
 * الرابط الذي يحمل data-no-guard يمر دون سؤال.
 */
export function useUnsavedGuard(dirty: boolean, message = UNSAVED_MESSAGE) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("data-no-guard") || a.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    // مرحلة الالتقاط على document تسبق معالج Next للروابط
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, message]);
}

/** سؤال التأكيد عند الإلغاء أو الإغلاق اليدوي؛ يعيد true إن لم توجد تغييرات أو وافق المستخدم. */
export const confirmDiscard = (dirty: boolean, message = UNSAVED_MESSAGE) => !dirty || window.confirm(message);
