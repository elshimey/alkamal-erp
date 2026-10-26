"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Truck } from "./icons";

const KEY = "truck-road";
const MAX_SPEED = 950; // بكسل في الثانية
const START_ACCEL = 140; // تنطلق ببطء...
const ACCEL_GROWTH = 900; // ...ثم يزيد تسارعها كلما استمر الضغط
const MAX_ACCEL = 1500;
const FRICTION = 260; // تتباطأ وحدها عند ترك السهم
const BRAKE = 2600;
const TRUCK_W = 76;
const MIN_X = 30; // يترك مكان زر الإخفاء

const subscribe = (cb: () => void) => {
  window.addEventListener(KEY, cb);
  return () => window.removeEventListener(KEY, cb);
};
const readHidden = () => {
  try {
    return localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
};

/**
 * طريق رفيع أسفل الشاشة للتسلية: الشاحنة واقفة ومحركها يعمل (تهتز، دخان من الخلف، أنوارها مضاءة).
 * يضغط المستخدم على الطريق ليتولى القيادة، ثم السهمان يميناً ويساراً للسير بتسارع تدريجي كسيارة حقيقية،
 * والمسافة للفرامل. خارج الطريق لا تلتقط المفاتيح شيئاً، فلا تتأثر الكتابة في الصفحات.
 * الحركة بـ requestAnimationFrame وتحويلات CSS، ولا تعمل الحلقة إلا أثناء القيادة.
 */
export function TruckRoad() {
  // الإخفاء يُحفظ في هذا المتصفح (null على الخادم حتى لا يظهر ثم يختفي)
  const hidden = useSyncExternalStore(subscribe, readHidden, () => null);
  const [driving, setDriving] = useState(false);
  const road = useRef<HTMLDivElement>(null);
  const truck = useRef<HTMLDivElement>(null);
  const s = useRef({ x: MIN_X, v: 0, frame: 0, last: 0, left: false, right: false, brake: false, held: 0, facingRight: false });

  const toggle = (off: boolean) => {
    try {
      localStorage.setItem(KEY, off ? "off" : "on");
    } catch {}
    window.dispatchEvent(new Event(KEY));
  };

  const paint = () => {
    const st = s.current;
    const el = truck.current;
    if (!el) return;
    const moving = Math.abs(st.v) > 3;
    if (moving) st.facingRight = st.v > 0;
    // الشاحنة مرسومة متجهة لليسار؛ تنقلب حين تسير يميناً، وتميل قليلاً للأمام عند الفرملة
    const braking = (st.brake || (st.left && st.v > 0) || (st.right && st.v < 0)) && moving;
    const tilt = braking ? (st.facingRight ? 3 : -3) : 0;
    el.style.transform = `translateX(${st.x}px) scaleX(${st.facingRight ? -1 : 1}) rotate(${tilt}deg)`;
    el.classList.toggle("truck-moving", moving);
    el.classList.toggle("truck-fast", Math.abs(st.v) > MAX_SPEED * 0.6);
    el.classList.toggle("truck-braking", braking || st.brake);
    el.classList.toggle("truck-skid", braking && Math.abs(st.v) > 250);
  };

  const step = (t: number) => {
    const st = s.current;
    const dt = Math.min((t - (st.last || t)) / 1000, 0.05);
    st.last = t;
    const dir = st.right && !st.left ? 1 : st.left && !st.right ? -1 : 0;
    if (st.brake) {
      const dv = BRAKE * dt;
      st.v = Math.abs(st.v) <= dv ? 0 : st.v - Math.sign(st.v) * dv;
      st.held = 0;
    } else if (dir) {
      if (st.v && Math.sign(st.v) !== dir) {
        // السهم المعاكس أثناء السير يخفف السرعة أولاً ثم يرجع للاتجاه الآخر
        const dv = BRAKE * 0.8 * dt;
        st.v = Math.abs(st.v) <= dv ? 0 : st.v - Math.sign(st.v) * dv;
        st.held = 0;
      } else {
        st.held += dt;
        const accel = Math.min(MAX_ACCEL, START_ACCEL + ACCEL_GROWTH * st.held);
        st.v = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, st.v + dir * accel * dt));
      }
    } else {
      st.held = 0;
      const dv = FRICTION * dt;
      st.v = Math.abs(st.v) <= dv ? 0 : st.v - Math.sign(st.v) * dv;
    }
    const max = (road.current?.clientWidth ?? 800) - TRUCK_W;
    const next = st.x + st.v * dt;
    st.x = Math.max(MIN_X, Math.min(max, next));
    if (st.x !== next) st.v = 0; // نهاية الطريق
    paint();
    if (st.v !== 0 || dir || st.brake) st.frame = requestAnimationFrame(step);
    else {
      st.frame = 0;
      st.last = 0;
      paint();
    }
  };

  const run = () => {
    if (!s.current.frame) s.current.frame = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelAnimationFrame(s.current.frame), []);

  const setKey = (e: React.KeyboardEvent, down: boolean) => {
    const st = s.current;
    // في الواجهة العربية الاتجاهات كما تظهر على الشاشة: السهم الأيمن يميناً والأيسر يساراً
    if (e.key === "ArrowRight") st.right = down;
    else if (e.key === "ArrowLeft") st.left = down;
    else if (e.key === " " || e.code === "Space") st.brake = down;
    else {
      if (down && e.key === "Escape") road.current?.blur();
      return;
    }
    e.preventDefault(); // لا تتحرك الصفحة بالأسهم أو المسافة أثناء القيادة
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    run();
  };

  const release = () => {
    const st = s.current;
    st.left = st.right = st.brake = false;
    setDriving(false);
    run(); // تكمل وتتباطأ وحدها حتى تقف
  };

  if (hidden === null) return null;
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => toggle(false)}
        title="إظهار طريق الشاحنة"
        aria-label="إظهار طريق الشاحنة"
        className="fixed bottom-3 end-3 z-20 hidden rounded-full bg-asphalt-900/90 p-1.5 opacity-60 shadow-lg transition hover:opacity-100 md:block print:hidden"
      >
        <Truck className="w-9" />
      </button>
    );
  }
  return (
    <div className="sticky bottom-0 z-20 hidden md:block print:hidden">
      <div
        ref={road}
        dir="ltr"
        tabIndex={0}
        role="application"
        aria-label="طريق الشاحنة: الأسهم للسير والمسافة للفرامل"
        onFocus={() => setDriving(true)}
        onBlur={release}
        onKeyDown={(e) => setKey(e, true)}
        onKeyUp={(e) => setKey(e, false)}
        className={`relative h-10 cursor-pointer overflow-hidden bg-asphalt-900 outline-none select-none transition-shadow ${driving ? "shadow-[inset_0_0_0_2px_var(--color-brand-600)]" : ""}`}
      >
        <div className="road-line-h absolute inset-x-0 top-1/2 -translate-y-1/2 opacity-50" />
        <span
          dir="rtl"
          className={`pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-asphalt-900 px-3 py-0.5 text-[11px] whitespace-nowrap ring-1 ${driving ? "text-brand-500 ring-brand-600/40" : "text-white/45 ring-white/10"}`}
        >
          {driving ? "الأسهم للقيادة · المسافة للفرامل · Esc للخروج" : "اضغط على الطريق لتقود الشاحنة"}
        </span>
        <div ref={truck} className="truck-road-car absolute bottom-1 left-0 will-change-transform" style={{ width: TRUCK_W, transform: `translateX(${MIN_X}px)` }}>
          <div className="truck-engine relative">
            <span className="truck-headlight" />
            <Truck className="w-full" spinning />
            <span className="truck-brake-light" />
            <span className="truck-smoke">
              <i />
              <i />
              <i />
            </span>
          </div>
          <span className="truck-skid-mark" />
        </div>
      </div>
      <button
        type="button"
        onClick={() => toggle(true)}
        title="إخفاء الطريق"
        aria-label="إخفاء الطريق"
        className="absolute top-1/2 end-2 -translate-y-1/2 rounded-md px-1.5 text-sm leading-none text-white/40 transition hover:bg-white/10 hover:text-white"
      >
        ×
      </button>
    </div>
  );
}
