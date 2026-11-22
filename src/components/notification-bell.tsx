"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useNarrow } from "@/lib/use-narrow";
import { bellPulse, bellState, markAllRead, markRead, officePushKey, saveOfficePush } from "@/app/(app)/notifications/actions";
import { onPushMessage, pollWhileVisible, pushState, subscribePush, usePushState } from "@/lib/push-client";
import { Icon } from "./icons";

type State = Awaited<ReturnType<typeof bellState>>;
// مربع الأيقونة بلون الخطورة
const TILE = { red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-700", blue: "bg-sky-50 text-sky-700" } as const;

/** جرس التنبيهات أعلى الصفحة: عدد غير المقروء، وقائمة مختصرة تفتح كل تنبيه، و«تعليم الكل كمقروء». */
export function NotificationBell() {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  // تبويبان: التشغيل اليومي، والوثائق (الامتثال) منفصلة حتى لا تضيع وسط أحداث السائقين
  const [tab, setTab] = useState<"ops" | "docs">("ops");
  const [, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
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
      const t = e.target as Node;
      if (!box.current?.contains(t) && !sheet.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // على الجوال لا تتحرك الصفحة خلف اللوحة
    if (narrow) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, narrow]);

  const unread = state?.unread ?? 0;
  const shown = state?.items.filter((a) => a.group === tab) ?? [];
  const go = (key: string, href: string) => {
    setOpen(false);
    start(async () => {
      await markRead(key);
      load();
      router.push(href);
    });
  };


  const tabs = (
    [
      ["ops", "التشغيل", state?.unreadOps ?? 0],
      ["docs", "الوثائق", state?.unreadDocs ?? 0],
    ] as const
  ).map(([k, label, n]) => (
    <button
      key={k}
      type="button"
      role="tab"
      aria-selected={tab === k}
      onClick={() => setTab(k)}
      className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[9px] text-sm transition ${tab === k ? "bg-white font-semibold text-asphalt-900 shadow-[0_1px_3px_rgba(27,33,38,0.12)]" : "text-gray-500 hover:text-gray-800"}`}
    >
      {label}
      {n > 0 && <span className={`ltr-nums min-w-[18px] rounded-full px-1 text-[11px] leading-[18px] ${tab === k && k === "docs" ? "bg-red-600 text-white" : "bg-gray-200 text-gray-600"}`}>{n}</span>}
    </button>
  ));
  const unreadList = shown.filter((a) => !a.read);
  const readList = shown.filter((a) => a.read);
  const item = (a: (typeof shown)[number]) => (
    <li key={a.key}>
      <button type="button" onClick={() => go(a.key, a.href)} className="relative flex w-full items-start gap-3 px-4 py-2.5 text-start text-sm transition hover:bg-[#faf8f3] active:bg-gray-100">
        {!a.read && <span aria-label="غير مقروء" className="absolute start-1.5 top-6 size-1.5 rounded-full bg-brand-600" />}
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-[11px] ${a.read ? "bg-gray-100 text-gray-400" : TILE[a.tone]}`}>
          <Icon name={a.icon} className="size-[18px]" />
        </span>
        <span className={`min-w-0 flex-1 pt-1.5 leading-relaxed ${a.read ? "text-gray-500" : "font-medium text-asphalt-900"}`}>{a.text}</span>
      </button>
    </li>
  );
  const body = (
    <div
      ref={sheet}
      role="dialog"
      aria-label="التنبيهات"
      className={
        narrow
          ? "animate-sheet-up absolute inset-x-0 bottom-0 flex max-h-[82dvh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-16px_40px_-12px_rgba(27,33,38,0.3)]"
          : "absolute end-0 z-50 mt-2 flex max-h-[min(36rem,calc(100dvh-6rem))] w-[25rem] flex-col overflow-hidden rounded-2xl border border-[#e7e2d6] bg-white shadow-[0_24px_48px_-16px_rgba(27,33,38,0.28),0_2px_6px_rgba(27,33,38,0.06)]"
      }
    >
      {narrow && <span aria-hidden="true" className="mx-auto mt-2.5 mb-0.5 h-[5px] w-10 shrink-0 rounded-full bg-[#d9d3c5]" />}
      <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2.5">
        <span className="flex items-center gap-2 font-display text-lg font-semibold text-asphalt-900">
          التنبيهات
          {unread > 0 && <span className="ltr-nums rounded-full bg-red-50 px-2 font-sans text-xs leading-5 font-medium text-red-700">{unread} جديدة</span>}
        </span>
        <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="flex size-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition hover:bg-gray-200 hover:text-gray-800">
          <Icon name="close" className="size-4" />
        </button>
      </div>
      {push === "default" && (
        <button type="button" onClick={() => void enablePush()} className="mx-4 mb-2 flex shrink-0 items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-start text-sm font-medium text-brand-800 hover:bg-brand-100">
          <Icon name="bell" className="size-4 shrink-0" />
          <span>فعّل الإشعارات الفورية على هذا الجهاز، لتصلك أفعال السائقين لحظة حدوثها</span>
        </button>
      )}
      {push === "denied" && <p className="mx-4 mb-2 shrink-0 text-xs text-gray-500">الإشعارات الفورية محظورة في هذا المتصفح؛ اسمح بها من إعدادات الموقع (رمز القفل بجانب العنوان).</p>}
      <div role="tablist" className="mx-4 mb-1 flex shrink-0 rounded-[11px] bg-[#f3f0e8] p-[3px]">
        {tabs}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">
        {!state && <p className="px-4 py-6 text-center text-sm text-gray-400">جارٍ التحميل…</p>}
        {state && shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-gray-500">{tab === "docs" ? "لا وثائق تحتاج تجديداً" : "لا توجد تنبيهات الآن"}</p>}
        {unreadList.length > 0 && (
          <>
            <p className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-500">جديدة</p>
            <ul>{unreadList.slice(0, 8).map(item)}</ul>
          </>
        )}
        {readList.length > 0 && unreadList.length < 8 && (
          <>
            <p className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-500">مقروءة</p>
            <ul>{readList.slice(0, 8 - unreadList.length).map(item)}</ul>
          </>
        )}
      </div>
      <div className="flex shrink-0 gap-2 border-t border-gray-100 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {unread > 0 && (
          <button type="button" onClick={() => start(async () => { await markAllRead(); load(); })} className="h-10 flex-1 rounded-[11px] border border-gray-200 bg-white text-sm font-semibold text-asphalt-900 transition hover:bg-gray-50">
            تعليم الكل كمقروء
          </button>
        )}
        <Link href={tab === "docs" ? "/notifications?tab=docs" : "/notifications"} onClick={() => setOpen(false)} className="flex h-10 flex-1 items-center justify-center rounded-[11px] bg-brand-600 text-sm font-semibold text-asphalt-900 transition hover:bg-brand-500">
          كل التنبيهات{shown.length > 8 ? ` (${shown.length})` : ""}
        </Link>
      </div>
    </div>
  );

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!open && state && !state.unreadOps && state.unreadDocs) setTab("docs");
          setOpen((o) => !o);
        }}
        aria-label={unread ? `التنبيهات: ${unread} غير مقروء` : "التنبيهات"}
        aria-expanded={open}
        className="relative flex size-9 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-brand-700"
      >
        <Icon name="bell" />
        {unread > 0 && <span className="ltr-nums absolute -top-0.5 -end-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] leading-[1.1rem] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (narrow ? createPortal(<div className="fixed inset-0 z-50 print:hidden">
          <button type="button" aria-label="إغلاق التنبيهات" onClick={() => setOpen(false)} className="animate-fade-in absolute inset-0 bg-asphalt-900/40" />
          {body}
        </div>, document.body) : body)}
    </div>
  );
}
