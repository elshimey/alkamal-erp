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
      // نافذة البرنامج بدل تأكيد المتصفح (الذي يجمّد الصفحة): نوقف الانتقال، وإن وافق نكرر النقر دون سؤال
      e.preventDefault();
      e.stopPropagation();
      void askConfirm(message).then((ok) => {
        if (!ok) return;
        a.setAttribute("data-no-guard", "");
        a.click();
        a.removeAttribute("data-no-guard");
      });
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
export const confirmDiscard = async (dirty: boolean, message = UNSAVED_MESSAGE) => !dirty || (await askConfirm(message));

let asking: Promise<boolean> | null = null;

/**
 * نافذة تأكيد من البرنامج نفسه بدل window.confirm (الذي يوقف الصفحة كلها حتى يُضغط).
 * لها «تجاهل التعديلات» و«متابعة التعديل» و× وEsc والنقر خارجها؛ كل طرق الإغلاق دون الموافقة = البقاء.
 */
export function askConfirm(message: string, confirmLabel = "تجاهل التعديلات", cancelLabel = "متابعة التعديل"): Promise<boolean> {
  if (asking) return asking;
  asking = new Promise<boolean>((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-confirm-dialog", "");
    overlay.className = "fixed inset-0 z-[200] flex items-center justify-center bg-asphalt-900/40 p-4";
    const box = document.createElement("div");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    box.className = "relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl";
    const x = document.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "إغلاق");
    x.textContent = "×";
    x.className = "absolute top-2 left-3 text-2xl leading-none text-gray-400 hover:text-gray-700";
    const text = document.createElement("p");
    text.className = "ms-0 me-6 text-sm leading-relaxed text-gray-800";
    text.textContent = message;
    const row = document.createElement("div");
    row.className = "mt-5 flex justify-end gap-2";
    const no = document.createElement("button");
    no.type = "button";
    no.textContent = cancelLabel;
    no.className = "rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = confirmLabel;
    yes.className = "rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700";
    row.append(no, yes);
    box.append(x, text, row);
    overlay.append(box);
    const done = (ok: boolean) => {
      window.removeEventListener("keydown", key, true);
      overlay.remove();
      asking = null;
      resolve(ok);
    };
    // Esc يغلق هذه النافذة وحدها، لا النافذة التي تحتها
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      done(false);
    };
    overlay.addEventListener("mousedown", (e) => e.target === overlay && done(false));
    x.addEventListener("click", () => done(false));
    no.addEventListener("click", () => done(false));
    yes.addEventListener("click", () => done(true));
    window.addEventListener("keydown", key, true);
    document.body.append(overlay);
    no.focus();
  });
  return asking;
}
