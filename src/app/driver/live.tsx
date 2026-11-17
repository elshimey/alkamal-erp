"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { driverPulseAction, driverPushKey, saveDriverPush } from "./actions";
import { onPushMessage, pollWhileVisible, pushState, subscribePush, usePushState } from "@/lib/push-client";

type Labels = { enable: string; hint: string; ios: string; denied: string; later: string };
const LATER_KEY = "driver-push-later";
const readLater = () => {
  try {
    return localStorage.getItem(LATER_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * يُبقي تطبيق السائق محدَّثاً: يعيد تحميل الصفحة فور وصول إشعار، واحتياطاً يفحص كل 15 ثانية.
 * ويعرض بطاقة تفعيل الإشعارات (أو شرح التثبيت على الآيفون) حتى يفعّلها السائق أو يختار «لاحقاً».
 */
export function DriverLive({ labels }: { labels: Labels }) {
  const router = useRouter();
  const last = useRef<string | null>(null);
  const state = usePushState();
  const storedLater = useSyncExternalStore(() => () => {}, readLater, () => true);
  const [later, setLater] = useState(false);
  const [, rerender] = useState(0);

  useEffect(() => {
    const offPush = onPushMessage(() => router.refresh());
    const offPoll = pollWhileVisible(() => {
      driverPulseAction()
        .then((p) => {
          const sig = `${p.last}:${p.unread}`;
          if (last.current !== null && sig !== last.current) router.refresh();
          last.current = sig;
        })
        .catch(() => {});
    });
    return () => {
      offPush();
      offPoll();
    };
  }, [router]);

  // يشترك هذا الجهاز ويحفظ اشتراكه؛ وعند الفشل يبقى الفحص الدوري يعمل
  const subscribe = useCallback(async (ask: boolean) => {
    try {
      const key = await driverPushKey();
      const sub = key ? await subscribePush("/driver-sw.js", "/driver", key, ask) : null;
      if (sub) await saveDriverPush(sub as Parameters<typeof saveDriverPush>[0]);
    } catch {}
  }, []);
  const enable = async () => {
    await subscribe(true);
    rerender((n) => n + 1);
  };
  // من سمح سابقاً يُجدَّد اشتراك جهازه بصمت
  useEffect(() => {
    if (pushState() === "granted") void subscribe(false);
  }, [subscribe]);

  if (later || storedLater || state === "granted" || state === "unsupported") return null;
  const dismiss = () => {
    setLater(true);
    try {
      localStorage.setItem(LATER_KEY, "1");
    } catch {}
  };
  return (
    <div className="mb-4 rounded-2xl border-2 border-brand-500 bg-brand-50 p-4 text-sm text-asphalt-900 shadow-sm">
      <p className="font-semibold">🔔 {state === "ios-install" ? labels.ios : state === "denied" ? labels.denied : labels.hint}</p>
      <div className="mt-3 flex gap-2">
        {state === "default" && (
          <button type="button" onClick={() => void enable()} className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-brand-900 shadow-sm active:scale-[0.98]">
            {labels.enable}
          </button>
        )}
        <button type="button" onClick={dismiss} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-700 active:bg-gray-50">
          {labels.later}
        </button>
      </div>
    </div>
  );
}
