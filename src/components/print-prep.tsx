"use client";

import { useEffect } from "react";

/**
 * قبل الطباعة (Ctrl+P أو زر «طباعة» من الكمبيوتر أو الجوال): كل تفصيل مطوي يحمل `data-print-open`
 * (مثل «مصاريف أخرى» بحساباتها في ربحية المركبات) يُفتح حتى يخرج كاملاً على الورق، ويُطوى بعدها كما كان.
 */
export function PrintPrep() {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-print-open]:not([open])"));
      for (const d of opened) d.open = true;
    };
    const after = () => {
      for (const d of opened) d.open = false;
      opened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return null;
}
