"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Truck } from "./icons";

const KEY = "truck-road";
const MAX_SPEED = 1100; // بكسل في الثانية
const ACCEL = 2600;
const BRAKE = 7000;
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
 * طريق رفيع أسفل الشاشة للتسلية: الشاحنة تنطلق بأقصى سرعة إلى مكان الماوس على الطريق،
 * والضغط على الطريق يدعس الفرامل فتتوقف فوراً بأضواء حمراء وأثر انزلاق.
 * الحركة بـ requestAnimationFrame وتحويلات CSS فقط، ولا تعمل إلا أثناء الحركة فلا تستهلك شيئاً وهي واقفة.
 */
export function TruckRoad() {
  // الإخفاء يُحفظ في هذا المتصفح (null على الخادم حتى لا يظهر ثم يختفي)
  const hidden = useSyncExternalStore(subscribe, readHidden, () => null);
  const road = useRef<HTMLDivElement>(null);
  const truck = useRef<HTMLDivElement>(null);
  const s = useRef({ x: MIN_X, v: 0, target: MIN_X, braking: false, frame: 0, last: 0, facingRight: false });

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
    const moving = Math.abs(st.v) > 4;
    if (moving) st.facingRight = st.v > 0;
    // الشاحنة مرسومة متجهة لليسار؛ تنقلب حين تسير يميناً، وتميل قليلاً للأمام عند الفرملة
    const tilt = st.braking && moving ? (st.facingRight ? 3 : -3) : 0;
    el.style.transform = `translateX(${st.x}px) scaleX(${st.facingRight ? -1 : 1}) rotate(${tilt}deg)`;
    el.classList.toggle("truck-moving", moving);
    el.classList.toggle("truck-braking", st.braking && moving);
  };

  const step = (t: number) => {
    const st = s.current;
    const dt = Math.min((t - (st.last || t)) / 1000, 0.05);
    st.last = t;
    if (st.braking) {
      const dv = BRAKE * dt;
      st.v = Math.abs(st.v) <= dv ? 0 : st.v - Math.sign(st.v) * dv;
    } else {
      const dist = st.target - st.x;
      // يسرع نحو الهدف ثم يخفف ليقف عنده تماماً
      const stopSpeed = Math.sqrt(2 * ACCEL * Math.abs(dist));
      const want = Math.sign(dist) * Math.min(MAX_SPEED, stopSpeed);
      const dv = ACCEL * dt;
      st.v = Math.abs(want - st.v) <= dv ? want : st.v + Math.sign(want - st.v) * dv;
      if (Math.abs(dist) < 1 && Math.abs(st.v) < 20) {
        st.x = st.target;
        st.v = 0;
      }
    }
    const max = (road.current?.clientWidth ?? 800) - TRUCK_W;
    st.x = Math.max(MIN_X, Math.min(max, st.x + st.v * dt));
    if (st.x === MIN_X || st.x === max) st.v = st.braking ? st.v : st.v * 0.5;
    paint();
    if (st.v !== 0 || (!st.braking && Math.abs(st.target - st.x) >= 1)) st.frame = requestAnimationFrame(step);
    else {
      st.frame = 0;
      st.last = 0;
      if (st.braking) setTimeout(() => truck.current?.classList.remove("truck-skid"), 600);
    }
  };

  const run = () => {
    if (!s.current.frame) s.current.frame = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelAnimationFrame(s.current.frame), []);

  const onMove = (e: React.PointerEvent) => {
    const r = road.current?.getBoundingClientRect();
    if (!r) return;
    const st = s.current;
    st.braking = false;
    st.target = Math.max(MIN_X, Math.min(r.width - TRUCK_W, e.clientX - r.left - TRUCK_W / 2));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      st.x = st.target;
      st.v = 0;
      paint();
      return;
    }
    run();
  };

  const onBrake = () => {
    const st = s.current;
    if (Math.abs(st.v) < 4) return;
    st.braking = true;
    truck.current?.classList.add("truck-skid");
    run();
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
        onPointerMove={onMove}
        onPointerDown={onBrake}
        title="مرّر الماوس على الطريق لتتحرك الشاحنة، واضغط لتدعس الفرامل"
        className="relative h-9 cursor-pointer touch-none overflow-hidden bg-asphalt-900 select-none"
      >
        <div className="road-line-h absolute inset-x-0 top-1/2 -translate-y-1/2 opacity-50" />
        <div ref={truck} className="truck-road-car absolute bottom-1 left-0 will-change-transform" style={{ width: TRUCK_W, transform: `translateX(${MIN_X}px)` }}>
          <span className="truck-skid-mark" />
          <Truck className="w-full" spinning />
          <span className="truck-brake-light" />
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
