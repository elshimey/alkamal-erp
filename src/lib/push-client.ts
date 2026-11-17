// أدوات المتصفح للإشعارات الفورية: الدعم، والاشتراك عبر عامل الخدمة، والاستماع لوصول إشعار والصفحة مفتوحة.

export type PushState = "unsupported" | "ios-install" | "default" | "denied" | "granted";

import { useSyncExternalStore } from "react";

const noop = () => () => {};
/** حالة الإشعار في هذا المتصفح (تُقرأ عند كل عرض؛ وعلى الخادم «غير مدعوم»). */
export function usePushState(): PushState {
  return useSyncExternalStore(noop, pushState, () => "unsupported");
}

export function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushState(): PushState {
  if (typeof window === "undefined") return "unsupported";
  const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // الآيفون لا يسمح بالإشعار إلا للتطبيق المثبت على الشاشة الرئيسية
  if (isIos() && !isStandalone()) return "ios-install";
  if (!ok) return "unsupported";
  return Notification.permission as PushState;
}

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * يشترك هذا الجهاز ويعيد بيانات الاشتراك لحفظها في الخادم.
 * ask=false: لا يطلب الإذن (يجدد الاشتراك بصمت لمن سمح سابقاً).
 */
export async function subscribePush(swUrl: string, scope: string, publicKey: string, ask: boolean): Promise<PushSubscriptionJSON | null> {
  const st = pushState();
  if (st === "unsupported" || st === "ios-install" || st === "denied") return null;
  if (st === "default") {
    if (!ask) return null;
    if ((await Notification.requestPermission()) !== "granted") return null;
  }
  const reg = await navigator.serviceWorker.register(swUrl, { scope });
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  return sub.toJSON();
}

/** يستدعي fn عند وصول إشعار والصفحة مفتوحة (يرسله عامل الخدمة). */
export function onPushMessage(fn: () => void) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  const h = (e: MessageEvent) => {
    if (e.data?.type === "push") fn();
  };
  navigator.serviceWorker.addEventListener("message", h);
  return () => navigator.serviceWorker.removeEventListener("message", h);
}

/**
 * فحص دوري احتياطي كل 15 ثانية والصفحة ظاهرة، وفور فتحها والعودة إليها.
 */
export function pollWhileVisible(tick: () => void, ms = 15_000) {
  const run = () => {
    if (document.visibilityState === "visible") tick();
  };
  run(); // خط الأساس فوراً، فلا يفوت جديد يصل قبل أول دورة
  const t = setInterval(run, ms);
  document.addEventListener("visibilitychange", run);
  window.addEventListener("focus", run);
  return () => {
    clearInterval(t);
    document.removeEventListener("visibilitychange", run);
    window.removeEventListener("focus", run);
  };
}
