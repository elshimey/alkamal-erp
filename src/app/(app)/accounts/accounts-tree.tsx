"use client";

// شجرة الحسابات بمجموعات تُفتح وتُطوى: العنوان عريض مع عدد الحسابات تحته، والحسابات مُزاحة تحت أبيها.
// البحث يفتح الفروع التي فيها نتيجة، و«فتح الكل/طي الكل» للشجرة كاملة.

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui";
import { norm } from "@/lib/filter-options";

export type TreeAccount = {
  id: number;
  code: string;
  nameAr: string;
  parentId: number | null;
  level: number;
  type: string;
  normalBalance: string;
  isPostable: boolean;
  requiresCostCenter: boolean;
  currencyCode: string | null;
  note: string | null;
  isActive: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  cost_of_revenue: "تكلفة الإيراد",
  expense: "مصروفات",
};

export function AccountsTree({ rows, canCreate }: { rows: TreeAccount[]; canCreate: boolean }) {
  const children = useMemo(() => {
    const m = new Map<number | null, TreeAccount[]>();
    for (const a of rows) m.set(a.parentId, [...(m.get(a.parentId) ?? []), a]);
    return m;
  }, [rows]);
  // تبدأ الشجرة مطوية بالكامل (الحسابات الرئيسية فقط)، والمستخدم يفتح ما يحتاجه (طلب أحمد 2026-11-18)
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [query, setQuery] = useState("");

  const q = norm(query);
  // عند البحث: الحساب المطابق وكل آبائه
  const visibleBySearch = useMemo(() => {
    if (!q) return null;
    const byId = new Map(rows.map((a) => [a.id, a]));
    const keep = new Set<number>();
    for (const a of rows) {
      if (!norm(a.nameAr).includes(q) && !a.code.startsWith(query.trim())) continue;
      for (let x: TreeAccount | undefined = a; x; x = x.parentId ? byId.get(x.parentId) : undefined) keep.add(x.id);
    }
    return keep;
  }, [q, query, rows]);

  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const countUnder = (id: number): number => (children.get(id) ?? []).reduce((n, c) => n + 1 + countUnder(c.id), 0);

  const lines: TreeAccount[] = [];
  const walk = (parent: number | null) => {
    for (const a of children.get(parent) ?? []) {
      if (visibleBySearch && !visibleBySearch.has(a.id)) continue;
      lines.push(a);
      if (visibleBySearch || open.has(a.id)) walk(a.id);
    }
  };
  walk(null);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 ابحث باسم الحساب أو رقمه"
          aria-label="بحث في شجرة الحسابات"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:max-w-sm"
        />
        <button type="button" onClick={() => setOpen(new Set(rows.filter((a) => !a.isPostable || children.has(a.id)).map((a) => a.id)))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50">
          فتح الكل
        </button>
        <button type="button" onClick={() => setOpen(new Set())} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50">
          طي الكل
        </button>
        <span className="ms-auto text-xs text-gray-500">
          <span className="ltr-nums">{rows.filter((a) => a.isPostable).length}</span> حساباً يقبل الترحيل من <span className="ltr-nums">{rows.length}</span>
        </span>
      </div>
      <div role="tree" aria-label="شجرة الحسابات" className="text-sm">
        {lines.length === 0 && <p className="p-6 text-center text-gray-400">لا يوجد حساب بهذا الاسم أو الرقم</p>}
        {lines.map((a) => {
          const kids = children.get(a.id)?.length ?? 0;
          const expanded = !!visibleBySearch || open.has(a.id);
          const group = kids > 0;
          return (
            <div
              key={a.id}
              role="treeitem"
              aria-expanded={group ? expanded : undefined}
              aria-selected={false}
              aria-level={a.level}
              className={`group flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-50 py-2 pe-3 transition hover:bg-brand-50/40 ${a.level === 1 ? "bg-asphalt-900/[0.04] font-bold text-brand-900" : group ? "font-semibold text-gray-800" : "text-gray-700"} ${a.isActive ? "" : "opacity-50"}`}
              style={{ paddingInlineStart: `${0.5 + (a.level - 1) * 1.5}rem` }}
            >
              {group ? (
                <button
                  type="button"
                  onClick={() => toggle(a.id)}
                  aria-label={expanded ? `طي ${a.nameAr}` : `فتح ${a.nameAr}`}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-gray-500 transition hover:bg-gray-200/70 hover:text-gray-800"
                >
                  <span aria-hidden className={`text-[10px] transition-transform ${expanded ? "" : "rotate-90"}`}>
                    ▼
                  </span>
                </button>
              ) : (
                <span aria-hidden className="grid size-6 shrink-0 place-items-center text-gray-300">
                  •
                </span>
              )}
              <span className="min-w-0 flex-1">
                {group ? (
                  <button type="button" onClick={() => toggle(a.id)} className="text-start">
                    {a.nameAr}
                  </button>
                ) : (
                  a.nameAr
                )}
                {group && !expanded && <span className="ms-2 text-xs font-normal text-gray-400">({countUnder(a.id)})</span>}
                <Link href={`/records/accounts/${a.id}`} className="ms-2 text-xs font-normal text-brand-700 opacity-0 transition group-hover:opacity-100 focus:opacity-100 print:hidden">
                  تعديل
                </Link>
                {canCreate && a.level < 4 && (
                  <Link href={`/accounts?add=1&parent=${a.id}`} className="ms-2 text-xs font-normal text-brand-700 opacity-0 transition group-hover:opacity-100 focus:opacity-100 print:hidden">
                    + حساب فرعي
                  </Link>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-1 text-xs font-normal">
                {a.isPostable ? <Badge tone="green">يقبل الترحيل</Badge> : null}
                {a.requiresCostCenter && <Badge tone="blue">مركبة إلزامية</Badge>}
                {a.currencyCode && <Badge tone="amber">{a.currencyCode}</Badge>}
                {!a.isActive && <Badge>موقوف</Badge>}
              </span>
              <span className="hidden w-24 text-xs font-normal text-gray-500 sm:inline">
                {TYPE_LABEL[a.type]} · {a.normalBalance === "debit" ? "مدين" : "دائن"}
              </span>
              <span dir="ltr" className="ltr-nums w-16 shrink-0 text-start text-xs font-normal text-gray-400">
                {a.code}
              </span>
              {a.note && <span className="basis-full ps-8 text-xs font-normal text-gray-500">{a.note}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
