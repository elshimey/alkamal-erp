"use client";

/** رسالة قصيرة أسفل الشاشة تختفي بعد 4 ثوانٍ (نجاح الحفظ مثلاً). */
export function toast(message: string) {
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.textContent = message;
  el.className = "fixed bottom-20 left-1/2 z-[95] -translate-x-1/2 rounded-xl bg-asphalt-900 px-4 py-2.5 text-sm text-white shadow-xl sm:bottom-6";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
