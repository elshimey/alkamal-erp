"use client";

import { useEffect } from "react";

const CACHE = "driver-v1"; // نفس مخزن عامل الخدمة public/driver-sw.js

/**
 * يحفظ صفحة «وثائقي» وملفات الوثائق في الجوال عند فتح التطبيق (قرار أحمد 2026-11-21)،
 * فتفتح في الكمين حتى بدون إنترنت. لا يعيد التحميل إلا إن تغيّرت الوثائق.
 */
export function DocCache({ files }: { files: number[] }) {
  const key = files.join(",");
  useEffect(() => {
    if (typeof caches === "undefined" || !navigator.onLine) return;
    const mark = `alk_doc_cache:${key}`;
    try {
      if (sessionStorage.getItem(mark)) return;
    } catch {}
    const urls = ["/driver/documents", ...key.split(",").filter(Boolean).map((id) => `/driver/files/${id}`)];
    caches
      .open(CACHE)
      .then((c) => Promise.all(urls.map((u) => fetch(u, { credentials: "same-origin" }).then((res) => (res.ok && !res.redirected ? c.put(u, res) : undefined)))))
      .then(() => {
        try {
          sessionStorage.setItem(mark, "1");
        } catch {}
      })
      .catch(() => {});
  }, [key]);
  return null;
}
