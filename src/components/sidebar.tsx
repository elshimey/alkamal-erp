"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";

/** تبلغ القائمة المنبثقة الشريطَ أنها مفتوحة حتى لا ينطوي وهي ظاهرة. */
const MenuContext = createContext<(open: boolean) => void>(() => {});
export const useSidebarMenu = () => useContext(MenuContext);

/**
 * الشريط الجانبي: مثبّت ومفتوح، أو مطوي إلى شريط أيقونات رفيع ينفتح فوق الصفحة
 * عند اقتراب الماوس منه وينطوي عند الابتعاد. زر الدبوس يبدّل بينهما، ويُحفظ الاختيار.
 */
export function Sidebar({ initialPinned, children }: { initialPinned: boolean; children: ReactNode }) {
  const [pinned, setPinned] = useState(initialPinned);
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const aside = useRef<HTMLElement>(null);
  const expanded = pinned || hover || menu;

  useEffect(() => () => clearTimeout(timer.current), []);

  // حدثا الدخول والخروج وحدهما قد يفوتان (انتقال صفحة، نافذة منبثقة، إطار مضمّن، خروج سريع من الشاشة)
  // فيبقى الشريط مفتوحاً والماوس بعيد عنه. ما دام مفتوحاً نراقب موضع الماوس نفسه ونطويه متى ابتعد.
  useEffect(() => {
    if (pinned || !hover) return;
    const away = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setHover(false), 280);
    };
    const move = (e: PointerEvent) => {
      const r = aside.current?.getBoundingClientRect();
      const inside = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (inside) clearTimeout(timer.current);
      else away();
    };
    const out = (e: MouseEvent) => !e.relatedTarget && away();
    const hide = () => document.visibilityState === "hidden" && setHover(false);
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("mouseout", out);
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("mouseout", out);
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [pinned, hover]);

  const enter = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(true), 80);
  };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHover(false), 280);
  };
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    if (!next) setHover(false);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "pinned" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div className={`sticky top-0 z-40 hidden h-screen shrink-0 transition-[width] duration-200 md:block print:hidden ${pinned ? "w-64" : "w-16"}`}>
      <aside
        ref={aside}
        // مطوي: أيقونات فقط بلا كتابة (تظهر الأسماء عند الفتح)
        data-rail={!expanded}
        onMouseEnter={pinned ? undefined : enter}
        onMouseLeave={pinned ? undefined : leave}
        className={`absolute inset-y-0 start-0 z-40 overflow-hidden bg-asphalt-900 text-white transition-[width,box-shadow] duration-200 ease-out ${expanded ? "w-64" : "w-16"} ${expanded && !pinned ? "shadow-[0_0_40px_-6px_rgba(0,0,0,0.45)]" : ""}`}
      >
        <div className="road-line absolute inset-y-0 end-0 opacity-70" />
        {/* المحتوى بعرض ثابت؛ الشريط يقصّه فقط حين ينطوي فلا تتكسر الأسطر */}
        <div className="flex h-full w-64 flex-col overflow-y-auto overflow-x-hidden">
          <MenuContext.Provider value={setMenu}>{children}</MenuContext.Provider>
        </div>
        <button
          type="button"
          onClick={togglePin}
          title={pinned ? "طيّ القائمة (تنفتح عند تمرير الماوس)" : "تثبيت القائمة مفتوحة"}
          aria-label={pinned ? "طيّ القائمة" : "تثبيت القائمة"}
          aria-pressed={pinned}
          className={`absolute top-3 end-2 rounded-lg p-1.5 transition ${expanded ? "opacity-100" : "pointer-events-none opacity-0"} ${pinned ? "text-brand-500 hover:bg-white/10" : "text-white/50 hover:bg-white/10 hover:text-white"}`}
        >
          <svg viewBox="0 0 24 24" className={`size-4 transition-transform ${pinned ? "" : "rotate-45"}`} fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
            <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
            <path d="M12 14v7" strokeLinecap="round" />
          </svg>
        </button>
      </aside>
    </div>
  );
}
