"use client";

// قائمة اختيار بالبحث: النتائج تضيق مع كل حرف، وآخر خيار «+ إضافة» يفتح نافذة الإضافة السريعة.
// تُستخدم في خلايا الشيت وسطور المستندات وحقول النماذج.

import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { QuickKind, QuickOption } from "@/lib/quick-add-types";
import { QuickAddDialog } from "./quick-add-dialog";
import { filterOptions, norm } from "@/lib/filter-options";

// ما يُضاف في هذه الصفحة يظهر فوراً في كل القوائم من النوع نفسه (كل صفوف الشيت)
const created = new Map<QuickKind, QuickOption[]>();
const listeners = new Set<() => void>();
let version = 0;
export function addCreatedOption(kind: QuickKind, option: QuickOption) {
  const list = created.get(kind) ?? [];
  if (!list.some((o) => o.value === option.value))
    created.set(kind, [...list, option]);
  version++;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** يعيد دالة تضيف للخيارات ما أُنشئ من نوعها في هذه الصفحة. */
export function useCreatedOptions() {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  return <T extends QuickOption>(
    kind: QuickKind | undefined,
    options: T[] | undefined,
  ): T[] => {
    const extra = kind ? (created.get(kind) ?? []) : [];
    const base = options ?? [];
    return extra.length
      ? [
          ...base,
          ...(extra.filter(
            (e) => !base.some((b) => b.value === e.value),
          ) as T[]),
        ]
      : base;
  };
}

type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onKeyDown" | "defaultValue"
>;

export function ComboBox({
  value,
  options,
  onChange,
  create,
  free,
  placeholder,
  className,
  inputProps,
  onKeyDownClosed,
  onCreated,
  disabled,
  allowEmpty = true,
  autoOpen = false,
  scope,
  createPrefix = "",
}: {
  value: string;
  options: QuickOption[];
  onChange: (value: string, option?: QuickOption) => void;
  /** زر الإضافة السريعة لهذا النوع */
  create?: QuickKind;
  /** نص حر مع اقتراحات (المرسل والمستلم): القيمة هي النص نفسه */
  free?: boolean;
  placeholder?: string;
  className?: string;
  inputProps?: InputProps & Record<`data-${string}`, string>;
  /** مفاتيح الأسهم وEnter حين تكون القائمة مغلقة (للتنقل بين صفوف الشيت) */
  onKeyDownClosed?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onCreated?: (option: QuickOption) => void;
  disabled?: boolean;
  allowEmpty?: boolean;
  /** تفتح القائمة فور ظهور الخانة (خلية شيت نُقر عليها) */
  autoOpen?: boolean;
  /** نطاق الإضافة السريعة (رمز الحساب الأب لحساب جديد مثلاً) */
  scope?: string;
  /** بادئة تُضاف لقيمة ما أُنشئ («vehicle:» في صاحب الوثيقة) */
  createPrefix?: string;
}) {
  const withCreated = useCreatedOptions();
  const all = withCreated(create, options);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(autoOpen);
  // فُتحت القائمة بنقرة الماوس التي أنشأت الحقل؛ تلك النقرة نفسها لا تغلقها
  const skipClick = useRef(autoOpen);
  useEffect(() => {
    if (!skipClick.current) return;
    const t = setTimeout(() => (skipClick.current = false), 400);
    return () => clearTimeout(t);
  }, []);
  const [active, setActive] = useState(0);
  // في الخانة الحرة لا يُختار اقتراح بـ Enter إلا إذا تنقّل المستخدم إليه بالأسهم
  const [moved, setMoved] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  // نص كُتب ولا يطابق أي خيار: تنبيه «غير موجود» مع زر الإضافة
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (missing == null) return;
    const t = setTimeout(() => setMissing(null), 8000);
    return () => clearTimeout(t);
  }, [missing]);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    up: boolean;
  } | null>(null);

  const selected = free ? undefined : all.find((o) => o.value === value);
  const text = query ?? (free ? value : (selected?.label ?? value));
  const shown = useMemo(() => filterOptions(all, query ?? ""), [all, query]);
  const q = (query ?? "").trim();
  const exact = q ? all.find((o) => norm(o.label) === norm(q)) : undefined;
  const createItem = create && !exact ? 1 : 0;
  const total = shown.length + createItem;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const up = r.bottom + 280 > window.innerHeight && r.top > 300;
      setPos({
        top: up ? r.top : r.bottom,
        left: r.left,
        width: Math.max(r.width, 240),
        up,
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (o: QuickOption) => {
    setMissing(null);
    onChange(o.value, o);
    setQuery(null);
    setOpen(false);
  };
  const startCreate = (text = q) => {
    setOpen(false);
    setMissing(null);
    setDialog(text);
  };

  /** عند مغادرة الخانة: النص المكتوب يُطابق خياراً أو يُلغى */
  const commit = () => {
    // فتح نافذة الإضافة ينقل التركيز منها، فلا يُعد النص «غير موجود»
    if (query == null || dialog != null) return;
    if (free) onChange(query.trim());
    else if (!q) {
      if (allowEmpty) onChange("");
    } else {
      const hit = exact ?? (shown.length === 1 ? shown[0] : undefined);
      if (hit) onChange(hit.value, hit);
      else setMissing(q);
    }
    setQuery(null);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open && total > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setMoved(true);
        setActive(
          (a) => (a + (e.key === "ArrowDown" ? 1 : -1) + total) % total,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (free && !moved) commit();
        else if (active < shown.length) pick(shown[active]);
        else startCreate();
        return;
      }
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      if (free) commit();
      else setQuery(null);
      return;
    }
    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive(0);
      return;
    }
    if (e.key === "Tab") commit();
    onKeyDownClosed?.(e);
  };

  // سهم يوضح أن الخانة قائمة اختيار (عدا الخانة الحرة)
  const arrow = !free;
  return (
    <span className="relative block">
      <input
        {...inputProps}
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        className={className}
        style={arrow ? { paddingInlineEnd: "1.6rem" } : undefined}
        onChange={(e) => {
          setMissing(null);
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          setMoved(false);
          // الخانة الحرة تحفظ ما يُكتب أولاً بأول (والمعاينة تتحدث معه)
          if (free) onChange(e.target.value);
        }}
        onClick={() => {
          if (skipClick.current) return void (skipClick.current = false);
          if (!disabled) setOpen((o) => !o);
        }}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          inputProps?.onFocus?.(e);
          e.target.select();
        }}
        onBlur={(e) => {
          inputProps?.onBlur?.(e);
          commit();
          // الانتقال لخانة أخرى يغلق قائمة هذه الخانة دائماً، حتى لو لم يُكتب فيها شيء
          setOpen(false);
        }}
      />
      {arrow && (
        <span aria-hidden className={`pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-[10px] transition ${open ? "rotate-180 text-brand-700" : "text-gray-400"}`}>
          ▼
        </span>
      )}
      {missing != null && !open && (
        <span role="alert" className="absolute start-0 top-full z-[60] mt-1 flex items-center gap-2 whitespace-nowrap rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 shadow-md">
          «{missing}» غير موجود في القائمة
          {create && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => startCreate(missing)} className="font-semibold text-brand-800 underline">
              + أضفه
            </button>
          )}
          <button type="button" aria-label="إغلاق" onClick={() => setMissing(null)} className="text-amber-700">
            ×
          </button>
        </span>
      )}
      {open &&
        pos &&
        total > 0 &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            dir="rtl"
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              ...(pos.up
                ? { bottom: window.innerHeight - pos.top + 2 }
                : { top: pos.top + 2 }),
            }}
            className="z-[90] max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-xl"
          >
            {shown.map((o, i) => (
              <Fragment key={o.value}>
                {!q && o.group && o.group !== shown[i - 1]?.group && (
                  <li role="presentation" className="sticky top-0 z-[1] border-y border-gray-100 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 first:border-t-0">
                    {o.group}
                  </li>
                )}
                <li
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 ${i === active ? "bg-brand-50 text-brand-900" : ""} ${o.value === value ? "font-semibold" : ""} ${!q && o.group ? "ps-5" : ""}`}
                >
                  <span>{o.label}</span>
                  {(q ? o.group : o.hint) && <span className="shrink-0 text-[11px] font-normal text-gray-400">{q ? o.group : o.hint}</span>}
                </li>
              </Fragment>
            ))}
            {createItem > 0 && (
              <li
                data-i={shown.length}
                role="option"
                aria-selected={active === shown.length}
                onMouseEnter={() => setActive(shown.length)}
                onClick={() => startCreate()}
                className={`cursor-pointer border-t border-gray-100 px-3 py-2 font-semibold text-brand-800 ${active === shown.length ? "bg-brand-50" : ""}`}
              >
                + إضافة {q ? `«${q}»` : "جديد"}
              </li>
            )}
          </ul>,
          document.body,
        )}
      {dialog != null && create && (
        <QuickAddDialog
          kind={create}
          scope={scope}
          initial={dialog}
          onClose={() => {
            setDialog(null);
            setQuery(null);
            setTimeout(() => inputRef.current?.focus());
          }}
          onDone={(created) => {
            const o = createPrefix ? { ...created, value: createPrefix + created.value } : created;
            addCreatedOption(create, o);
            setMissing(null);
            onCreated?.(o);
            onChange(o.value, o);
          }}
        />
      )}
    </span>
  );
}

/** حقل نموذج بالبحث وزر الإضافة؛ القيمة تُرسل في حقل مخفي بالاسم المعطى. */
export function ComboField({
  name,
  options,
  defaultValue = "",
  create,
  required,
  placeholder,
  onChange,
}: {
  name: string;
  options: QuickOption[];
  defaultValue?: string;
  create?: QuickKind;
  required?: boolean;
  placeholder?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />
      <ComboBox
        value={value}
        options={options}
        create={create}
        placeholder={placeholder ?? "ابحث أو اختر…"}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        inputProps={{ required: required && !value, "aria-required": required }}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
      />
    </div>
  );
}
