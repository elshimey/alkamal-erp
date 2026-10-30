"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { addFundingAccount } from "@/app/(app)/accounts/actions";
import { norm } from "@/lib/filter-options";

type Account = { id: number; code: string; nameAr: string };

// المجموعات المعتادة لصرف العهدة؛ باقي حسابات الدليل مخفية حتى يطلبها المستخدم فلا يُختار حساب خطأ
const GROUPS = [
  { prefix: "1101", label: "الصناديق والخزائن الفرعية", icon: "💵" },
  { prefix: "1102", label: "البنوك", icon: "🏦" },
  { prefix: "1105", label: "عهد الموظفين", icon: "👤" },
] as const;
const NEW_KINDS = [
  { value: "cash", label: "صندوق / خزينة فرعية" },
  { value: "bank", label: "حساب بنكي" },
  { value: "custody", label: "عهدة موظف" },
] as const;

const groupOf = (code: string) => GROUPS.find((g) => code.startsWith(g.prefix));

/**
 * اختيار الحساب الذي يُصرف منه المبلغ (عهدة الرحلة، سداد المخالفات…).
 * قائمة مقسمة بعناوين واضحة (الاسم كبير والرقم بجانبه)، مع بحث، و«+ حساب جديد» يضيف الحساب للدليل ويختاره فوراً.
 * لا تستخدم نوافذ عائمة لأنها تعمل داخل نافذة التأكيد.
 */
export function CashAccountField({ options, name: fieldName = "cashAccountId", label = "تُصرف عهدة الرحلة من" }: { options: Account[]; name?: string; label?: string }) {
  const [added, setAdded] = useState<Account[]>([]);
  const all = useMemo(() => [...options, ...added.filter((a) => !options.some((o) => o.id === a.id))], [options, added]);
  const first = all.find((a) => a.code.startsWith("1101")) ?? all[0];
  const [value, setValue] = useState(first ? String(first.id) : "");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<(typeof NEW_KINDS)[number]["value"]>("cash");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [saving, start] = useTransition();
  const hidden = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // تفريغ النموذج يعيد الاختيار الأول
  useEffect(() => {
    const form = hidden.current?.form;
    const reset = () => setValue(first ? String(first.id) : "");
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [first]);
  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  const q = norm(query);
  const match = (a: Account) => !q || norm(a.nameAr).includes(q) || a.code.startsWith(query.trim());
  const selected = all.find((a) => String(a.id) === value);
  const sections = [
    ...GROUPS.map((g) => ({ ...g, rows: all.filter((a) => a.code.startsWith(g.prefix) && match(a)) })),
    ...(showAll || q ? [{ prefix: "other", label: "حسابات أخرى من الدليل", icon: "📒", rows: all.filter((a) => !groupOf(a.code) && match(a)) }] : []),
  ].filter((g) => g.rows.length);

  const save = () => {
    if (!name.trim()) return setError("اكتب اسم الحساب");
    setError(undefined);
    start(async () => {
      const r = await addFundingAccount(kind, name);
      if ("error" in r) return setError(r.error);
      setAdded((list) => [...list, r.account]);
      setValue(String(r.account.id));
      setQuery("");
      setName("");
      setAdding(false);
    });
  };
  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter يضيف الحساب وEsc يغلق الإضافة فقط، لا نافذة التأكيد
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setAdding(false);
    }
  };

  return (
    <div className="text-sm">
      <input ref={hidden} type="hidden" name={fieldName} value={value} />
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-medium text-gray-700">{label}</span>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-800 transition hover:bg-brand-50">
            + حساب جديد
          </button>
        )}
      </div>

      {selected && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border-2 border-brand-500 bg-brand-50 px-3 py-2">
          <span className="font-semibold text-brand-900">
            {groupOf(selected.code)?.icon ?? "📒"} {selected.nameAr}
          </span>
          <span className="ltr-nums text-xs text-brand-800" dir="ltr">
            {selected.code}
          </span>
        </div>
      )}

      {adding && (
        <div className="mb-2 space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs font-semibold text-gray-600">حساب جديد في دليل الحسابات</div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="نوع الحساب">
            {NEW_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={kind === k.value}
                onClick={() => setKind(k.value)}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${kind === k.value ? "border-brand-500 bg-white font-semibold text-brand-900" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"}`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onNameKey}
            placeholder={kind === "custody" ? "مثال: عهدة – أحمد (المحاسب)" : kind === "bank" ? "مثال: بنك الأهلي – جاري" : "مثال: خزينة فرع الدمام"}
            aria-label="اسم الحساب"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => (setAdding(false), setError(undefined))} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100">
              إلغاء
            </button>
            <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-brand-900 hover:bg-brand-500 disabled:opacity-60">
              {saving ? "جارٍ الإضافة…" : "إضافة واختيار"}
            </button>
          </div>
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.stopPropagation())}
        placeholder="🔍 ابحث بالاسم أو الرقم"
        aria-label="بحث في الحسابات"
        className="mb-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
      />
      <div role="radiogroup" aria-label="الحساب" className="max-h-56 overflow-y-auto rounded-xl border border-gray-200 bg-white">
        {sections.length === 0 && <p className="p-3 text-center text-xs text-gray-400">لا يوجد حساب بهذا الاسم</p>}
        {sections.map((g) => (
          <div key={g.prefix}>
            <div className="sticky top-0 z-[1] border-b border-gray-100 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
              {g.icon} {g.label}
            </div>
            {g.rows.map((a) => {
              const on = String(a.id) === value;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setValue(String(a.id))}
                  className={`flex w-full items-center justify-between gap-3 border-b border-gray-50 px-3 py-2 text-start transition last:border-0 ${on ? "bg-brand-50 font-semibold text-brand-900" : "hover:bg-gray-50"}`}
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-full border ${on ? "border-brand-600 bg-brand-600 text-[10px] text-white" : "border-gray-300"}`}>
                      {on ? "✓" : ""}
                    </span>
                    {a.nameAr}
                  </span>
                  <span className="ltr-nums shrink-0 text-xs text-gray-400" dir="ltr">
                    {a.code}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {!q && (
        <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          إظهار باقي حسابات الدليل (للحالات الخاصة)
        </label>
      )}
    </div>
  );
}
