"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ComponentProps, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";

// حقل تاريخ يعرض يوم/شهر/سنة دائماً مهما كانت لغة المتصفح، ويُرسل القيمة بصيغة 2026-10-25 كالحقل الأصلي.
// الكتابة: 25/10/2026 أو 25-10-2026 أو 2026-10-25 أو 25102026 (تُضاف الشرطات تلقائياً)، أو 25/10 للسنة الحالية.
// زر التقويم يفتح تقويماً عربياً واضحاً: الشهر والسنة، أيام الأسبوع، «اليوم» و«مسح».

export const isoToDmy = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const digits = (t: string) => t.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

export const dmyToIso = (text: string) => {
  let t = digits(text.trim());
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return valid(t);
  if (/^\d{8}$/.test(t)) t = `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4)}`;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (!m) return null;
  return valid(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
};

function valid(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** يوم/شهر بلا سنة: يُكمل بالسنة الحالية عند مغادرة الخانة. */
const withYear = (text: string) => {
  const m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(digits(text.trim()));
  return m ? dmyToIso(`${m[1]}/${m[2]}/${new Date().getFullYear()}`) : null;
};

/** تنسيق أثناء الكتابة: 2510 ← 25/10، و25102026 ← 25/10/2026. */
const mask = (prev: string, next: string) => {
  const t = digits(next);
  if (t.length < prev.length || !/^[\d/]*$/.test(t)) return next;
  const d = t.replace(/\//g, "");
  if (/^\d{4}-/.test(t) || d.length > 8) return next;
  if (d.length >= 5) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  if (d.length >= 3 && !t.includes("/")) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return t;
};

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const DAYS = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => {
  const n = new Date();
  return isoOf(n.getFullYear(), n.getMonth(), n.getDate());
};

type Props = Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value?: string;
  defaultValue?: string;
  onChange?: (e: { target: { value: string } }) => void;
};

export function DateInput({ value, defaultValue, onChange, name, required, min, max, className, form, disabled, id, ...rest }: Props) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const iso = controlled ? value : inner;
  const [text, setText] = useState<string | null>(null); // نص أثناء الكتابة قبل أن يكتمل تاريخاً صحيحاً
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const silent = useRef(false);

  // تفريغ النموذج يعيد القيمة الأولى
  useEffect(() => {
    const f = hidden.current?.form;
    if (!f || controlled) return;
    const reset = () => (setInner(defaultValue ?? ""), setText(null));
    f.addEventListener("reset", reset);
    return () => f.removeEventListener("reset", reset);
  }, [controlled, defaultValue]);

  const commit = (next: string) => {
    if (!controlled) setInner(next);
    onChange?.({ target: { value: next } });
    // الحقل المخفي لا يُطلق حدث تغيير وحده؛ نُبلغ النموذج (مؤشر «تعديلات لم تُحفظ» وغيره)
    queueMicrotask(() => {
      silent.current = true;
      hidden.current?.dispatchEvent(new Event("change", { bubbles: true }));
      silent.current = false;
    });
  };
  const type = (e: ChangeEvent<HTMLInputElement>) => {
    const next = mask(text ?? isoToDmy(iso), e.target.value);
    setText(next);
    const parsed = dmyToIso(next);
    if (parsed) commit(parsed);
    else if (!next.trim()) commit("");
  };
  const blur = () => {
    if (text != null) {
      const y = withYear(text);
      if (y) commit(y);
    }
    setText(null);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && e.altKey) {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  // عرض محدد (w-40 مثلاً) يبقى للخانة، وإلا تملأ مكانها ولا تتجاوزه
  const fixedWidth = !!className?.includes("w-") && !className.includes("w-full");
  return (
    <span ref={box} className={`relative inline-flex items-center ${fixedWidth ? "" : "w-full"}`}>
      <input
        {...rest}
        id={id}
        disabled={disabled}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        placeholder="يوم/شهر/سنة"
        value={text ?? isoToDmy(iso)}
        onChange={type}
        onBlur={blur}
        onKeyDown={key}
        className={`${className ?? ""} ${fixedWidth ? "" : "w-full min-w-0"} ltr-nums ps-9 text-start`}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="اختر من التقويم"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`absolute end-2 rounded p-1 transition ${open ? "bg-brand-50 text-brand-800" : "text-gray-400 hover:text-gray-700"}`}
      >
        <Icon name="calendar" className="size-4" />
      </button>
      {/* الحقل الأصلي مخفي بصرياً: يحمل الاسم والقيمة للنموذج ويتحقق من الإلزام والحدود */}
      <input
        ref={hidden}
        type="date"
        name={name}
        form={form}
        required={required}
        min={min}
        max={max}
        disabled={disabled}
        value={iso}
        onChange={(e) => {
          if (silent.current) return;
          setText(null);
          commit(e.target.value);
        }}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute bottom-0 start-0 h-px w-px opacity-0"
      />
      {open && (
        <Calendar
          anchor={box}
          value={iso}
          min={typeof min === "string" ? min : undefined}
          max={typeof max === "string" ? max : undefined}
          onPick={(d) => {
            setText(null);
            commit(d);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

/**
 * زر التقويم وحده لخلايا الشيتات (شيت الإضافة والتعديل الجماعي): يفتح التقويم نفسه الذي في النماذج.
 * value بصيغة 2026-10-25 أو 25/10/2026، وonPick يعيد 2026-10-25.
 */
export function DatePickButton({ value, onPick, className }: { value: string; onPick: (iso: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : (dmyToIso(value) ?? "");
  return (
    <span ref={box} className={className ?? "absolute end-1 top-1/2 -translate-y-1/2"}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="اختر من التقويم"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={`rounded p-0.5 transition ${open ? "bg-brand-50 text-brand-800" : "text-gray-400 hover:text-brand-700"}`}
      >
        <Icon name="calendar" className="size-3.5" />
      </button>
      {open && (
        <Calendar
          anchor={box}
          value={iso}
          onPick={(d) => {
            setOpen(false);
            onPick(d);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

function Calendar({ anchor: anchorRef, value, min, max, onPick, onClose }: { anchor: RefObject<HTMLSpanElement | null>; value: string; min?: string; max?: string; onPick: (iso: string) => void; onClose: () => void }) {
  const start = value || todayIso();
  const [view, setView] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
  // days: أيام الشهر، months: اختيار الشهر، years: اختيار السنة (بالنقر على اسم الشهر أو السنة)
  const [mode, setMode] = useState<"days" | "months" | "years">("days");
  const [yearPage, setYearPage] = useState(Number(start.slice(0, 4)) - 5);
  const [pos, setPos] = useState<{ top: number; left: number; host: HTMLElement; fixed: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      // داخل نافذة مفتوحة يُعرض التقويم فيها (ما خارجها لا يستجيب للنقر)
      const host = (anchor.closest("dialog[open]") as HTMLElement | null) ?? document.body;
      const width = 272;
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      if (host === document.body) {
        const up = r.bottom + 330 > window.innerHeight && r.top > 340;
        setPos({ top: up ? r.top - 330 : r.bottom + 4, left, host, fixed: true });
      } else {
        const b = host.getBoundingClientRect();
        setPos({ top: r.bottom + 4 - b.top + host.scrollTop, left: left - b.left, host, fixed: false });
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const anchor = anchorRef.current;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
      // النقر على عنوان قسم لإغلاق التقويم يغلقه فقط، ولا يطوي القسم فيختفي ما بعده (ملاحظة التشغيل 5)
      const header = (t as Element).closest?.("summary");
      if (header) {
        const swallow = (c: MouseEvent) => {
          if (header.contains(c.target as Node)) {
            c.preventDefault();
            c.stopPropagation();
          }
        };
        document.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => document.removeEventListener("click", swallow, true), 500);
      }
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // يغلق التقويم وحده، لا النافذة التي هو فيها
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", esc, true);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;
  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const today = todayIso();
  const shift = (n: number) => setView((v) => ({ y: v.y + Math.floor((v.m + n) / 12), m: (((v.m + n) % 12) + 12) % 12 }));
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max);
  // السهمان: شهر في عرض الأيام، سنة في عرض الشهور، 12 سنة في عرض السنوات
  const step = (dir: 1 | -1) => {
    if (mode === "days") shift(dir);
    else if (mode === "months") setView((v) => ({ ...v, y: v.y + dir }));
    else setYearPage((p) => p + dir * 12);
  };
  const years = Array.from({ length: 12 }, (_, i) => yearPage + i);
  const curY = Number(today.slice(0, 4));
  const curM = Number(today.slice(5, 7)) - 1;
  const pickBtn = (active: boolean, current: boolean) =>
    `ltr-nums grid h-10 place-items-center rounded-lg text-sm transition ${active ? "bg-brand-600 font-bold text-brand-900" : current ? "font-bold text-brand-800 ring-1 ring-brand-400 ring-inset hover:bg-brand-50" : "hover:bg-brand-50"}`;
  const headBtn = (on: boolean) => `flex items-center whitespace-nowrap gap-1 rounded-lg border px-2 py-1 transition ${on ? "border-brand-400 bg-brand-50 text-brand-900" : "border-gray-200 hover:border-brand-300 hover:bg-gray-50"}`;
  const caret = (on: boolean) => (
    <svg viewBox="0 0 24 24" className={`size-3.5 text-gray-500 transition-transform ${on ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return createPortal(
    <div
      ref={ref}
      dir="rtl"
      role="dialog"
      aria-label="التقويم"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
      style={{ position: pos.fixed ? "fixed" : "absolute", top: pos.top, left: pos.left, width: 272 }}
      className="animate-fade-in z-[96] rounded-2xl border border-gray-200 bg-white p-3 text-sm text-gray-800 shadow-xl"
    >
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" onClick={() => step(-1)} aria-label={mode === "days" ? "الشهر السابق" : mode === "months" ? "السنة السابقة" : "السنوات السابقة"} className="grid size-8 place-items-center rounded-lg text-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800">
          ›
        </button>
        <div className="flex items-center gap-1 font-display font-semibold text-brand-900">
          <button type="button" onClick={() => setMode((m) => (m === "months" ? "days" : "months"))} aria-label="اختر الشهر" aria-expanded={mode === "months"} className={headBtn(mode === "months")}>
            {MONTHS[view.m]}
            {caret(mode === "months")}
          </button>
          <button
            type="button"
            onClick={() => {
              setYearPage(view.y - 5);
              setMode((m) => (m === "years" ? "days" : "years"));
            }}
            aria-label="اختر السنة"
            aria-expanded={mode === "years"}
            className={`ltr-nums ${headBtn(mode === "years")}`}
          >
            {mode === "years" ? `${years[0]}–${years[years.length - 1]}` : view.y}
            {caret(mode === "years")}
          </button>
        </div>
        <button type="button" onClick={() => step(1)} aria-label={mode === "days" ? "الشهر التالي" : mode === "months" ? "السنة التالية" : "السنوات التالية"} className="grid size-8 place-items-center rounded-lg text-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800">
          ‹
        </button>
      </div>
      {mode === "months" && (
        <div className="grid grid-cols-3 gap-1.5 py-1" role="listbox" aria-label="الشهور">
          {MONTHS.map((n, i) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={i === view.m}
              onClick={() => {
                setView((v) => ({ ...v, m: i }));
                setMode("days");
              }}
              className={pickBtn(i === view.m, i === curM && view.y === curY)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      {mode === "years" && (
        <div className="grid grid-cols-4 gap-1.5 py-1" role="listbox" aria-label="السنوات">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              role="option"
              aria-selected={y === view.y}
              onClick={() => {
                setView((v) => ({ ...v, y }));
                setMode("months");
              }}
              className={pickBtn(y === view.y, y === curY)}
            >
              {y}
            </button>
          ))}
        </div>
      )}
      {mode === "days" && (
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DAYS.map((d) => (
          <span key={d} className="py-1 text-[10px] font-semibold text-gray-400">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d == null) return <span key={`e${i}`} />;
          const iso = isoOf(view.y, view.m, d);
          const on = iso === value;
          const ok = allowed(iso);
          return (
            <button
              key={iso}
              type="button"
              disabled={!ok}
              onClick={() => onPick(iso)}
              aria-label={`${d} ${MONTHS[view.m]} ${view.y}`}
              aria-pressed={on}
              className={`ltr-nums grid h-8 place-items-center rounded-lg transition ${on ? "bg-brand-600 font-bold text-brand-900" : iso === today ? "font-bold text-brand-800 ring-1 ring-brand-400 ring-inset" : "hover:bg-brand-50"} ${ok ? "" : "cursor-not-allowed opacity-30"}`}
            >
              {d}
            </button>
          );
        })}
      </div>
      )}
      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-xs">
        <button type="button" disabled={!allowed(today)} onClick={() => onPick(today)} className="rounded-lg px-2 py-1 font-semibold text-brand-800 transition hover:bg-brand-50 disabled:opacity-40">
          اليوم
        </button>
        <span className="ltr-nums text-gray-400">{value ? isoToDmy(value) : "يوم/شهر/سنة"}</span>
        <button type="button" onClick={() => onPick("")} className="rounded-lg px-2 py-1 text-gray-500 transition hover:bg-gray-100">
          مسح
        </button>
      </div>
    </div>,
    pos.host,
  );
}
