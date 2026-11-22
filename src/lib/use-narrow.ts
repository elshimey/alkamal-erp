"use client";

import { useSyncExternalStore } from "react";

// الجوال (أقل من 768): اللوحات تصعد من أسفل الشاشة؛ الكمبيوتر: نافذة أو معاينة جانبية
const NARROW = "(max-width: 767px)";
const onMedia = (cb: () => void) => {
  const m = window.matchMedia(NARROW);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** هل الشاشة بعرض الجوال؟ (false عند العرض على الخادم) */
export const useNarrow = () =>
  useSyncExternalStore(
    onMedia,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
