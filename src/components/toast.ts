"use client";

import { fillMsg } from "./msg-text";
import { msgHasLink } from "@/lib/msg-links";

/**
 * رسالة قصيرة أسفل الشاشة (نجاح الحفظ أو خطأ إجراء). الرسالة التي توجّه لصفحة أخرى تعرض رابطها
 * (`msgSegments`) وتبقى حتى تُغلق بـ× أو بعد 15 ثانية، ولا تختفي والمؤشر عليها.
 */
export function toast(message: string, error = false) {
  const linked = msgHasLink(message);
  const el = document.createElement("div");
  el.setAttribute("role", error ? "alert" : "status");
  el.className = `fixed bottom-20 left-1/2 z-[95] flex max-w-[90vw] -translate-x-1/2 items-start gap-3 rounded-xl px-4 py-2.5 text-sm whitespace-pre-line text-white shadow-xl sm:bottom-6 ${error ? "bg-red-700" : "bg-asphalt-900"}`;
  const body = document.createElement("span");
  fillMsg(body, message);
  el.append(body);
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    el.remove();
  };
  const wait = () => {
    clearTimeout(timer);
    timer = window.setTimeout(close, linked ? 15000 : error ? 6000 : 4000);
  };
  if (linked) {
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", "إغلاق");
    x.className = "-me-1 shrink-0 text-lg leading-none opacity-80 hover:opacity-100";
    x.onclick = close;
    el.append(x);
    el.onmouseenter = () => clearTimeout(timer);
    el.onmouseleave = wait;
    body.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a")) close();
    });
  }
  document.body.appendChild(el);
  wait();
}
