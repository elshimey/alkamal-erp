"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PendingContext, type FormState } from "@/components/action-form";
import { breakdownAction, documentAction, expenseAction, fuelAction, stageAction, tripExpenseAction } from "./actions";

// العمل دون إنترنت: ما يُدخله السائق بلا شبكة يُحفظ في الجوال (IndexedDB) ويُرسل تلقائياً عند عودتها.
// كل عملية تحمل معرّفاً (_op) فلا تتكرر في الخادم إن أُرسلت مرتين.
const ACTIONS = { stage: stageAction, fuel: fuelAction, tripExpense: tripExpenseAction, expense: expenseAction, breakdown: breakdownAction, document: documentAction } as const;
export type OfflineActionKey = keyof typeof ACTIONS;
type Queued = { id: string; key: OfflineActionKey; fields: [string, string][]; at: number };

const DB = "driver-offline";
const STORE = "queue";
const EVENT = "driver-queue-changed";

function idb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((ok, fail) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}
const queueAll = () => tx<Queued[]>("readonly", (s) => s.getAll() as IDBRequest<Queued[]>);
const queuePut = (q: Queued) => tx("readwrite", (s) => s.put(q));
const queueDelete = (id: string) => tx("readwrite", (s) => s.delete(id));

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const toFormData = (fields: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  return fd;
};
// فشل الشبكة (لا رد من الخادم) يختلف عن خطأ في البيانات يعيده الخادم
const isNetworkError = (err: unknown) => err instanceof TypeError || (err instanceof Error && /fetch|network|load failed/i.test(err.message));

/** نموذج في تطبيق السائق يُرسل فوراً، أو يُحفظ في الجوال إن لم توجد شبكة. */
export function DriverForm({ actionKey, children, className = "", savedOffline }: { actionKey: OfflineActionKey; children: ReactNode; className?: string; savedOffline: string }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>();
  const [pending, setPending] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const queue = async (fields: [string, string][]) => {
    await queuePut({ id: uid(), key: actionKey, fields, at: Date.now() });
    window.dispatchEvent(new Event(EVENT));
    form.current?.reset();
    setState({ ok: savedOffline });
  };

  return (
    <PendingContext.Provider value={pending}>
      <form
        ref={form}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (!fd.get("_op")) fd.set("_op", uid());
          const fields = [...fd.entries()].map(([k, v]) => [k, String(v)] as [string, string]);
          setPending(true);
          startTransition(async () => {
            try {
              if (!navigator.onLine) return await queue(fields);
              const res = await ACTIONS[actionKey](undefined, fd);
              setState(res);
              if (res?.ok) {
                form.current?.reset();
                router.refresh();
              }
            } catch (err) {
              if (isNetworkError(err)) await queue(fields);
              else setState({ error: err instanceof Error ? err.message : String(err) });
            } finally {
              setPending(false);
            }
          });
        }}
      >
        {children}
        {state?.error && <p role="alert" className="col-span-full mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm whitespace-pre-line text-red-700">{state.error}</p>}
        {state?.ok && <p className="col-span-full mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p>}
      </form>
    </PendingContext.Provider>
  );
}

/** شريط العمليات المحفوظة في الجوال، ويرسلها تلقائياً عند عودة الشبكة. */
export function OfflineSync({ labels }: { labels: { offline: string; pending: string; sending: string; retry: string; failed: string } }) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const running = useRef(false);

  const refresh = useCallback(async () => setCount((await queueAll().catch(() => [])).length), []);
  const flush = useCallback(async () => {
    if (running.current || !navigator.onLine) return;
    running.current = true;
    setBusy(true);
    try {
      const items = (await queueAll()).sort((a, b) => a.at - b.at);
      let sent = 0;
      for (const q of items) {
        try {
          const res = await ACTIONS[q.key](undefined, toFormData(q.fields));
          // خطأ في البيانات لا يُعاد إرساله؛ يُعرض للسائق ليدخله من جديد
          if (res?.error) setFailed(res.error);
          await queueDelete(q.id);
          sent++;
        } catch (err) {
          if (isNetworkError(err)) break;
          setFailed(err instanceof Error ? err.message : String(err));
          await queueDelete(q.id);
        }
      }
      if (sent) router.refresh();
    } finally {
      running.current = false;
      setBusy(false);
      void refresh();
    }
  }, [refresh, router]);

  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void flush();
    };
    const changed = () => void refresh();
    const first = setTimeout(() => {
      update();
      void refresh();
    }, 0);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener(EVENT, changed);
    const timer = setInterval(() => void flush(), 30_000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener(EVENT, changed);
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [flush, refresh]);

  // تسجيل عامل الخدمة ليفتح التطبيق حتى دون شبكة
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/driver-sw.js", { scope: "/driver" }).catch(() => {});
  }, []);

  if (online && !count && !failed) return null;
  return (
    <div className={`mx-auto mb-3 max-w-md rounded-xl px-3 py-2 text-sm ${online ? "bg-sky-50 text-sky-900" : "bg-amber-50 text-amber-900"}`}>
      {!online && <div className="font-semibold">{labels.offline}</div>}
      {count > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span>
            {labels.pending}: <b className="ltr-nums">{count}</b>
          </span>
          {online && (
            <button type="button" disabled={busy} onClick={() => void flush()} className="rounded-lg bg-white px-2 py-1 text-xs font-medium shadow-sm">
              {busy ? labels.sending : labels.retry}
            </button>
          )}
        </div>
      )}
      {failed && (
        <div className="mt-1 text-xs text-red-700">
          {labels.failed}: {failed}
        </div>
      )}
    </div>
  );
}

/** التقاط صورة بكاميرا الجوال وضغطها قبل الإرسال (تُحفظ كنص في حقل مخفي). */
export function PhotoInput({ name = "photo", label, required = false }: { name?: string; label: string; required?: boolean }) {
  const [data, setData] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      setData(canvas.toDataURL("image/jpeg", 0.7));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3">
      <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm font-medium text-gray-700 active:scale-[0.99]">
        <span aria-hidden>📷</span>
        {busy ? "…" : label}
        <input type="file" accept="image/*" capture="environment" className="sr-only" required={required && !data} onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {data && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data} alt="" className="size-14 rounded-lg object-cover ring-1 ring-black/10" />
      )}
      <input type="hidden" name={name} value={data} />
    </div>
  );
}
