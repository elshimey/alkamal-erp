"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DriverDict } from "@/data/driver-i18n";
import type { DriverDocRow } from "@/lib/driver-docs";
import { Pill } from "../../driver-ui";

type Tab = "mine" | "vehicle" | "trailer";
type Group = { plate: string | null; rows: DriverDocRow[]; empty: string | null };
const TONE = { valid: "green", soon: "amber", expired: "red", missing: "gray", none: "gray" } as const;
const EDGE = { valid: "border-s-green-600", soon: "border-s-brand-600", expired: "border-s-red-600 bg-red-50", missing: "border-s-gray-300", none: "border-s-gray-300" } as const;

export function DocsView({
  t,
  groups,
  initialTab,
  driverName,
  pendingTypes,
  upload,
}: {
  t: DriverDict["docs"];
  groups: Record<Tab, Group>;
  initialTab: Tab;
  driverName: string;
  pendingTypes: number[];
  upload: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [open, setOpen] = useState<DriverDocRow | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const g = groups[tab];
  const label = (r: DriverDocRow) =>
    r.state === "expired" && r.days != null
      ? t.expiredSince.replace("{n}", String(-r.days))
      : r.state === "soon" && r.days != null
        ? t.daysLeft.replace("{n}", String(r.days))
        : t.states[r.state];
  const dot = (k: Tab) => (groups[k].rows.some((r) => r.state === "expired") ? "bg-red-600" : groups[k].rows.some((r) => r.state === "soon") ? "bg-brand-600" : null);

  // Esc يغلق عارض الوثيقة
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const tabs: [Tab, string][] = [
    ["mine", t.tabMine],
    ["vehicle", t.tabVehicle],
    ["trailer", t.tabTrailer],
  ];
  return (
    <>
      <div role="tablist" className="sticky top-0 z-30 -mx-4 mb-2 grid grid-cols-3 gap-1.5 bg-concrete px-4 py-2">
        {tabs.map(([k, l]) => {
          const d = dot(k);
          return (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={tab === k}
              onClick={() => {
                setTab(k);
                setShowUpload(false);
              }}
              className={`relative rounded-xl border py-3 text-[15px] font-semibold transition ${tab === k ? "border-asphalt-900 bg-asphalt-900 text-brand-500" : "border-gray-300 bg-white text-gray-700"}`}
            >
              {l}
              {d && <span aria-hidden className={`absolute end-2 top-1.5 size-2.5 rounded-full ring-2 ring-white ${d}`} />}
            </button>
          );
        })}
      </div>

      <p className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
        {g.plate ? (
          <span className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-bold whitespace-nowrap">{g.plate}</span>
        ) : (
          <b className="font-semibold">{tab === "mine" ? driverName : ""}</b>
        )}
        <span className="text-xs text-green-700">✓ {t.savedOffline}</span>
      </p>

      {g.empty ? (
        <p className="rounded-2xl bg-white p-5 text-center text-sm text-gray-500 shadow-sm">{g.empty}</p>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_16px_-8px_rgba(27,33,38,0.12)]">
          {g.rows.map((r) => {
            const body = (
              <>
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${r.fileId == null ? "bg-gray-100 text-gray-400" : r.isPdf ? "bg-red-700 text-white" : "bg-gradient-to-br from-[#e8e1cf] to-[#b9ad92]"}`}>
                  {r.fileId == null ? "—" : r.isPdf ? "PDF" : ""}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="text-[15px] font-semibold">{r.name}</b>
                  <small className="text-xs text-gray-500">
                    {r.expiryDate ? (
                      <>
                        {r.state === "expired" ? t.expiredOn : t.expires} <span className="ltr-nums">{r.expiryDate.split("-").reverse().join("/")}</span>
                      </>
                    ) : r.state === "missing" || r.state === "none" ? (
                      t.notRegistered
                    ) : (
                      t.noExpiry
                    )}
                    {pendingTypes.includes(r.typeId) && <> · {t.renewalPending}</>}
                  </small>
                </span>
                <Pill tone={TONE[r.state]}>{label(r)}</Pill>
                {r.fileId != null && (
                  <span aria-hidden className="text-xl text-gray-400 rtl:rotate-0 ltr:rotate-180">
                    ‹
                  </span>
                )}
              </>
            );
            const cls = `flex w-full items-center gap-3 border-s-4 px-3.5 py-3 text-start ${EDGE[r.state]}`;
            return (
              <li key={r.typeId} className="border-t border-gray-100 first:border-t-0">
                {r.fileId != null ? (
                  <button type="button" className={`${cls} active:bg-gray-50`} onClick={() => setOpen(r)}>
                    {body}
                  </button>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!g.empty && (
        <button type="button" onClick={() => setShowUpload((v) => !v)} className="mt-3 w-full rounded-2xl border-2 border-dashed border-gray-300 p-3 text-sm font-semibold text-asphalt-900">
          {showUpload ? `✕ ${t.close}` : `＋ ${t.upload}`}
        </button>
      )}
      {/* النموذج يبقى في الصفحة مخفياً حتى لا يضيع ما كتبه السائق عند التبديل */}
      <div hidden={!showUpload} className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-asphalt-900">{t.upload}</h2>
        {upload}
      </div>

      {open && open.fileId != null && (
        <div role="dialog" aria-modal="true" aria-label={open.name} className="fixed inset-0 z-50 flex flex-col bg-[#0d1114] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-white">
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <button type="button" onClick={() => setOpen(null)} aria-label={t.close} className="flex size-9 items-center justify-center rounded-full bg-white/10 text-base">
              ✕
            </button>
            <b className="min-w-0 flex-1 truncate text-[15px]">{open.name}</b>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto p-3" onClick={(e) => e.target === e.currentTarget && setOpen(null)}>
            {open.isPdf ? (
              <a href={`/driver/files/${open.fileId}`} target="_blank" rel="noreferrer" className="flex aspect-[0.72] w-full max-w-xs flex-col items-center justify-center gap-2 rounded-md bg-white text-asphalt-900">
                <span className="rounded-md bg-red-700 px-2.5 py-1.5 font-bold text-white">PDF</span>
                <b>{open.name}</b>
                <span className="text-sm text-brand-700 underline">{t.openFile}</span>
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/driver/files/${open.fileId}`} alt={open.name} className="max-h-full max-w-full rounded-lg object-contain" />
            )}
          </div>
          {!open.isPdf && <p className="mb-2 text-center text-xs text-white/55">{t.zoomHint}</p>}
          <div className="px-4 pb-4">
            <a href={`/driver/files/${open.fileId}?download=1`} download className="block w-full rounded-xl bg-brand-600 py-3 text-center text-base font-semibold text-asphalt-900">
              {t.download}
            </a>
          </div>
        </div>
      )}
    </>
  );
}
