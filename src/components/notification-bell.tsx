"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { bellPulse, bellState, markAllRead, markRead, officePushKey, saveOfficePush } from "@/app/(app)/notifications/actions";
import { onPushMessage, pollWhileVisible, pushState, subscribePush, usePushState } from "@/lib/push-client";
import { Icon } from "./icons";

type State = Awaited<ReturnType<typeof bellState>>;
const TONE = { red: "bg-red-500", amber: "bg-amber-500", blue: "bg-sky-500" } as const;

/** جرس التنبيهات أعلى الصفحة: عدد غير المقروء، وقائمة مختصرة تفتح كل تنبيه، و«تعليم الكل كمقروء». */
export function NotificationBell() {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const lastEvent = useRef<number | null>(null);
  const push = usePushState();
  const [, rerender] = useState(0);

  const load = useCallback(() => {
    bellState()
      .then(setState)
      .catch(() => {});
  }, []);
  // يُحدَّث عند التنقل، وفوراً عند وصول إشعار، وكل دقيقتين، وعند تعليم التنبيهات من صفحتها.
  // واحتياطاً لمن لم يفعّل الإشعارات: فحص خفيف كل 15 ثانية لرقم آخر حدث، والجرس يُعاد عند الجديد فقط.
  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    window.addEventListener("alerts-changed", load);
    const offPush = onPushMessage(load);
    const offPoll = pollWhileVisible(() => {
      bellPulse()
        .then((id) => {
          if (lastEvent.current !== null && id !== lastEvent.current) load();
          lastEvent.current = id;
        })
        .catch(() => {});
    });
    return () => {
      clearInterval(t);
      window.removeEventListener("alerts-changed", load);
      offPush();
      offPoll();
    };
  }, [load, pathname]);

  // يشترك هذا الجهاز ويحفظ اشتراكه؛ وعند الفشل يبقى الفحص الدوري يعمل
  const subscribe = useCallback(async (ask: boolean) => {
    try {
      const key = await officePushKey();
      const sub = key ? await subscribePush("/office-sw.js", "/", key, ask) : null;
      if (sub) await saveOfficePush(sub as Parameters<typeof saveOfficePush>[0]);
    } catch {}
  }, []);
  const enablePush = async () => {
    await subscribe(true);
    rerender((n) => n + 1);
  };
  // من سمح سابقاً يُجدَّد اشتراك جهازه بصمت
  useEffect(() => {
    if (pushState() === "granted") void subscribe(false);
  }, [subscribe]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = state?.unread ?? 0;
  const go = (key: string, href: string) => {
    setOpen(false);
    start(async () => {
      await markRead(key);
      load();
      router.push(href);
    });
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `التنبيهات: ${unread} غير مقروء` : "التنبيهات"}
        aria-expanded={open}
        className="relative flex size-9 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-brand-700"
      >
        <Icon name="bell" />
        {unread > 0 && <span className="ltr-nums absolute -top-0.5 -end-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] leading-[1.1rem] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute end-0 z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="font-display font-semibold text-gray-900">التنبيهات</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button type="button" onClick={() => start(async () => { await markAllRead(); load(); })} className="text-xs font-medium text-brand-700 hover:underline">
                  تعليم الكل كمقروء
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-lg px-1.5 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                ×
              </button>
            </div>
          </div>
          {push === "default" && (
            <button type="button" onClick={() => void enablePush()} className="flex w-full items-center gap-2 border-b border-gray-100 bg-brand-50 px-4 py-2.5 text-start text-sm font-medium text-brand-800 hover:bg-brand-100">
              <Icon name="bell" className="size-4 shrink-0" />
              <span>فعّل الإشعارات الفورية على هذا الجهاز، لتصلك أفعال السائقين لحظة حدوثها</span>
            </button>
          )}
          {push === "denied" && <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">الإشعارات الفورية محظورة في هذا المتصفح؛ اسمح بها من إعدادات الموقع (رمز القفل بجانب العنوان).</p>}
          <ul className="max-h-96 divide-y divide-gray-50 overflow-y-auto">
            {!state && <li className="px-4 py-6 text-center text-sm text-gray-400">جارٍ التحميل…</li>}
            {state && state.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-500">لا توجد تنبيهات الآن</li>}
            {state?.items.slice(0, 8).map((a) => (
              <li key={a.key}>
                <button type="button" onClick={() => go(a.key, a.href)} className={`flex w-full items-start gap-3 px-4 py-3 text-start text-sm transition hover:bg-gray-50 ${a.read ? "text-gray-500" : "font-medium text-gray-900"}`}>
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${a.read ? "bg-gray-300" : TONE[a.tone]}`} />
                  <span>{a.text}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-gray-100 px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-gray-50">
            كل التنبيهات{state && state.items.length > 8 ? ` (${state.items.length})` : ""}
          </Link>
        </div>
      )}
    </div>
  );
}
