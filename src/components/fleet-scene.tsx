"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cityPoint } from "@/data/city-coords";
import type { SceneTrip } from "@/lib/dashboard";

// «مشهد الأسطول»: خريطة مجسّمة خفيفة (SVG وCSS فقط، دون مكتبات) للرحلات الجارية.
// تشغيلية فقط: لا أرقام مالية. مكان الشاحنة على الطريق تقريبي، فلا يوجد تتبع GPS.

const W = 900;
const H = 440;
const PAD = 70;
const C = Math.cos(Math.PI / 6);
const TILE = 30;

// نفس معنى ألوان الحالات في كل الشاشات (st-* في globals.css)
const TONE = {
  run: "#3a86ad",
  wait: "#e9a100",
  done: "#2f9a57",
  bad: "#d2402f",
} as const;
const STAGE_LABEL = {
  run: "في الطريق",
  wait: "أُرسلت للسائق ولم تُحمَّل",
  done: "سُلّمت وتنتظر الاعتماد",
} as const;

type Hub = {
  key: string;
  name: string;
  country: string;
  x: number;
  y: number;
  out: number;
  in: number;
  wait: number;
  done: number;
  blocked: number;
};
type Pick = { kind: "hub"; key: string } | { kind: "trip"; id: number } | null;

const pts = (a: [number, number][]) =>
  a.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");

/** صندوق مجسّم حول نقطة على الأرض: a على محور اليمين، b على محور اليسار، h الارتفاع (بالبكسل). */
function boxFaces(cx: number, cy: number, a: number, b: number, h: number) {
  const u: [number, number] = [C * a, 0.5 * a];
  const v: [number, number] = [-C * b, 0.5 * b];
  const at = (su: number, sv: number, up = 0): [number, number] => [
    cx + su * u[0] + sv * v[0],
    cy + su * u[1] + sv * v[1] - up,
  ];
  return {
    left: pts([at(-1, 1), at(1, 1), at(1, 1, h), at(-1, 1, h)]),
    right: pts([at(1, -1), at(1, 1), at(1, 1, h), at(1, -1, h)]),
    top: pts([at(-1, -1, h), at(1, -1, h), at(1, 1, h), at(-1, 1, h)]),
    stripe: pts([
      at(-1, -0.18, h),
      at(1, -0.18, h),
      at(1, 0.18, h),
      at(-1, 0.18, h),
    ]),
    peak: at(0, 0, h),
  };
}

function layout(trips: SceneTrip[]) {
  const hubs = new Map<string, Hub>();
  const hub = (name: string, country: string) => {
    const key = `${country}|${name}`;
    let h = hubs.get(key);
    if (!h) {
      const [lat, lon] = cityPoint(name, country);
      h = {
        key,
        name,
        country,
        x: lon,
        y: -lat,
        out: 0,
        in: 0,
        wait: 0,
        done: 0,
        blocked: 0,
      };
      hubs.set(key, h);
    }
    return h;
  };
  for (const t of trips) {
    const f = hub(t.from, t.fromCountry);
    const d = hub(t.to, t.toCountry);
    f.out++;
    d.in++;
    if (t.stage === "wait") f.wait++;
    if (t.stage === "done") d.done++;
    if (t.blocked) (t.stage === "done" ? d : f).blocked++;
  }
  const list = [...hubs.values()];
  // ملاءمة الإحداثيات للمساحة مع الحفاظ على النسبة
  const xs = list.map((h) => h.x);
  const ys = list.map((h) => h.y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const k = Math.min(
    (W - 2 * PAD) / Math.max(maxX - minX, 1e-6),
    (H - 2 * PAD) / Math.max(maxY - minY, 1e-6),
    90,
  );
  const ox = W / 2 - ((minX + maxX) / 2) * k;
  const oy = H / 2 + 10 - ((minY + maxY) / 2) * k;
  for (const h of list) {
    h.x = h.x * k + ox;
    h.y = h.y * k + oy;
  }
  // المدن المتقاربة (الدمام والخبر مثلاً) تُبعَد قليلاً حتى لا تتراكب
  for (let pass = 0; pass < 30; pass++) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x || 1;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 78) {
          const push = (78 - dist) / 2 / dist;
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
        }
      }
  }
  for (const h of list) {
    h.x = Math.min(W - 40, Math.max(40, h.x));
    h.y = Math.min(H - 30, Math.max(60, h.y));
  }

  // الطرق: زوج واحد لكل مدينتين، والشاحنات موزعة على طول الطريق
  const roads = new Map<string, { a: Hub; b: Hub }>();
  const onRoad = new Map<string, SceneTrip[]>();
  for (const t of trips) {
    const a = hubs.get(`${t.fromCountry}|${t.from}`)!;
    const b = hubs.get(`${t.toCountry}|${t.to}`)!;
    if (a === b) continue;
    const key = [a.key, b.key].sort().join("~");
    if (!roads.has(key)) roads.set(key, { a, b });
    if (t.stage === "run")
      onRoad.set(`${a.key}>${b.key}`, [
        ...(onRoad.get(`${a.key}>${b.key}`) ?? []),
        t,
      ]);
  }
  const trucks: { trip: SceneTrip; x: number; y: number }[] = [];
  const parked = new Map<string, number>();
  for (const t of trips) {
    const a = hubs.get(`${t.fromCountry}|${t.from}`)!;
    const b = hubs.get(`${t.toCountry}|${t.to}`)!;
    if (t.stage === "run" && a !== b) {
      const same = onRoad.get(`${a.key}>${b.key}`)!;
      const p = (same.indexOf(t) + 1) / (same.length + 1);
      trucks.push({
        trip: t,
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
      });
    } else {
      // الواقفة تصطف أمام المدينة: المنتظرة عند البداية، والمسلّمة عند الوجهة
      const at = t.stage === "done" ? b : a;
      const n = parked.get(at.key) ?? 0;
      parked.set(at.key, n + 1);
      const col = n % 4;
      const row = Math.floor(n / 4);
      trucks.push({
        trip: t,
        x: at.x - 30 + col * 16 + row * 8,
        y: at.y + 30 + row * 10 - col * 2,
      });
    }
  }
  trucks.sort((p, q) => p.y - q.y);

  // أرضية من بلاط مجسّم يغطي المشهد
  const tiles: string[] = [];
  for (let gx = -40; gx <= 40; gx++)
    for (let gy = -40; gy <= 40; gy++) {
      const x = W / 2 + (gx - gy) * C * TILE;
      const y = (gx + gy) * 0.5 * TILE;
      if (x < -TILE * 2 || x > W + TILE * 2 || y < -TILE || y > H + TILE)
        continue;
      if ((gx + gy) % 2) continue;
      tiles.push(
        pts([
          [x, y - TILE / 2],
          [x + C * TILE, y],
          [x, y + TILE / 2],
          [x - C * TILE, y],
        ]),
      );
    }

  return { hubs: list, roads: [...roads.values()], trucks, tiles };
}

export function FleetScene({ trips }: { trips: SceneTrip[] }) {
  const scene = useMemo(() => layout(trips), [trips]);
  const [view, setView] = useState<"scene" | "list">("scene");
  const busiest = useMemo(
    () => [...scene.hubs].sort((a, b) => b.out + b.in - (a.out + a.in))[0]?.key,
    [scene],
  );
  const [pick, setPick] = useState<Pick>(null);
  const current: Pick =
    pick ?? (busiest ? { kind: "hub", key: busiest } : null);

  // اختيار المستخدم يُحفظ على جهازه، والأجهزة الضعيفة تبدأ بالعرض المبسّط
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("fleet-scene-view");
    } catch {}
    const nav = navigator as Navigator & { deviceMemory?: number };
    const weak =
      (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
    const next =
      saved === "list" || saved === "scene" ? saved : weak ? "list" : "scene";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- القراءة من الجهاز لا تتم إلا بعد التحميل
    if (next !== "scene") setView(next);
  }, []);
  // على الجوال يتسع المشهد بالتمرير الأفقي، ويبدأ من منتصفه
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const mid = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollLeft = getComputedStyle(el).direction === "rtl" ? -mid : mid;
  }, [view]);
  const choose = (v: "scene" | "list") => {
    setView(v);
    try {
      localStorage.setItem("fleet-scene-view", v);
    } catch {}
  };

  const counts = {
    run: trips.filter((t) => t.stage === "run" && !t.blocked).length,
    wait: trips.filter((t) => t.stage === "wait" && !t.blocked).length,
    done: trips.filter((t) => t.stage === "done" && !t.blocked).length,
    bad: trips.filter((t) => t.blocked).length,
  };

  if (trips.length === 0)
    return (
      <p className="rounded-xl bg-concrete px-4 py-6 text-center text-sm text-gray-500">
        لا رحلات جارية الآن. تظهر هنا كل شحنة تُرسل للسائق حتى يعتمدها المكتب.
      </p>
    );

  const legend = (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {(["run", "wait", "done", "bad"] as const).map((k) => (
        <span
          key={k}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white px-2.5 py-0.5"
        >
          <span
            className="size-2 rounded-full"
            style={{ background: TONE[k] }}
          />
          {k === "bad"
            ? "متوقفة لوثيقة منتهية"
            : k === "run"
              ? "في الطريق"
              : k === "wait"
                ? "تنتظر التحميل"
                : "تنتظر الاعتماد"}
          <b className="tabular-nums">{counts[k]}</b>
        </span>
      ))}
    </div>
  );

  const list = (
    <ul className="divide-y divide-gray-100 text-sm">
      {trips.map((t) => (
        <li key={t.id}>
          <Link
            href={`/waybills/${t.id}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:bg-concrete"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: t.blocked ? TONE.bad : TONE[t.stage] }}
            />
            <span className="ltr-nums text-xs text-gray-500">{t.number}</span>
            <span className="font-medium">
              <bdi>{t.from}</bdi> ← <bdi>{t.to}</bdi>
            </span>
            <span className="text-gray-500">{t.plate ?? "—"}</span>
            <span className="ms-auto text-xs text-gray-500">
              {t.blocked ? "وثيقة منتهية" : STAGE_LABEL[t.stage]}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

  const selHub =
    current?.kind === "hub"
      ? scene.hubs.find((h) => h.key === current.key)
      : undefined;
  const selTrip =
    current?.kind === "trip"
      ? trips.find((t) => t.id === current.id)
      : undefined;
  const select = (p: Pick) => () => setPick(p);
  const keySelect = (p: Pick) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPick(p);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {legend}
        <div
          className="flex gap-0.5 rounded-lg border border-black/[0.06] bg-concrete p-0.5 text-xs print:hidden"
          role="group"
          aria-label="طريقة العرض"
        >
          {(["scene", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => choose(v)}
              className={`rounded-md px-3 py-1 ${view === v ? "bg-white font-medium text-asphalt-900 shadow-sm" : "text-gray-500 hover:text-asphalt-900"}`}
            >
              {v === "scene" ? "المشهد" : "عرض مبسّط"}
            </button>
          ))}
        </div>
      </div>

      {view === "scene" && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem] print:hidden">
          <div
            ref={box}
            className="min-w-0 overflow-x-auto rounded-xl border border-black/[0.06] bg-[#e9e5da]"
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="block h-auto w-full min-w-[600px]"
              role="img"
              aria-label="مشهد مجسّم للمدن والطرق والشاحنات الجارية"
            >
              <g fill="#dcd7c9">
                {scene.tiles.map((p, i) => (
                  <polygon key={i} points={p} />
                ))}
              </g>
              {scene.roads.map(({ a, b }) => (
                <g key={`${a.key}~${b.key}`}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#3d4952"
                    strokeWidth={13}
                    strokeLinecap="round"
                  />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#f5b82e"
                    strokeWidth={2}
                    strokeDasharray="9 7"
                    className="scene-lane"
                  />
                </g>
              ))}
              {scene.hubs.map((h) => {
                const size = Math.min(26, 14 + (h.out + h.in) * 1.5);
                const f = boxFaces(h.x, h.y, size, size * 0.8, size * 0.9);
                const p: Pick = { kind: "hub", key: h.key };
                const on = selHub?.key === h.key;
                return (
                  <g
                    key={h.key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${h.name}: ${h.out} خارجة و${h.in} داخلة`}
                    onClick={select(p)}
                    onKeyDown={keySelect(p)}
                    className="cursor-pointer outline-none [&:focus-visible>polygon]:stroke-[#e9a100]"
                  >
                    <polygon
                      points={f.left}
                      fill="#cfc9ba"
                      stroke={on ? "#e9a100" : "none"}
                      strokeWidth={2}
                    />
                    <polygon
                      points={f.right}
                      fill="#b9b2a1"
                      stroke={on ? "#e9a100" : "none"}
                      strokeWidth={2}
                    />
                    <polygon
                      points={f.top}
                      fill="#ffffff"
                      stroke={on ? "#e9a100" : "none"}
                      strokeWidth={2}
                    />
                    <polygon
                      points={f.stripe}
                      fill={h.country === "SA" ? "#f5b82e" : "#3a86ad"}
                    />
                    <text
                      x={f.peak[0]}
                      y={f.peak[1] - size * 0.9}
                      textAnchor="middle"
                      className="font-display"
                      fontSize={15}
                      fontWeight={600}
                      fill="#1b2126"
                      stroke="#e9e5da"
                      strokeWidth={4}
                      paintOrder="stroke"
                    >
                      {h.name}
                    </text>
                  </g>
                );
              })}
              {scene.trucks.map(({ trip, x, y }) => {
                const f = boxFaces(x, y, 9, 6, 6);
                const color = trip.blocked ? TONE.bad : TONE[trip.stage];
                const p: Pick = { kind: "trip", id: trip.id };
                const on = selTrip?.id === trip.id;
                return (
                  <g
                    key={trip.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`شحنة ${trip.number}`}
                    onClick={select(p)}
                    onKeyDown={keySelect(p)}
                    className={`cursor-pointer outline-none ${trip.stage === "run" ? "scene-truck" : ""}`}
                  >
                    <polygon points={f.left} fill="#1b2126" />
                    <polygon points={f.right} fill="#303a42" />
                    <polygon
                      points={f.top}
                      fill={color}
                      stroke={on ? "#1b2126" : "none"}
                      strokeWidth={1.5}
                    />
                    {trip.blocked && (
                      <g>
                        <circle
                          cx={f.peak[0]}
                          cy={f.peak[1] - 12}
                          r={6.5}
                          fill={TONE.bad}
                        />
                        <text
                          x={f.peak[0]}
                          y={f.peak[1] - 8.5}
                          textAnchor="middle"
                          fontSize={10}
                          fontWeight={700}
                          fill="#fff"
                        >
                          !
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          <div
            className="grid content-start gap-1 rounded-xl border border-black/[0.06] bg-concrete p-3 text-sm"
            aria-live="polite"
          >
            {selTrip ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <b className="font-display">{selTrip.plate ?? "دون مركبة"}</b>
                  <span className="ltr-nums text-xs text-gray-500">
                    {selTrip.number}
                  </span>
                </div>
                <span>
                  <bdi>{selTrip.from}</bdi> ← <bdi>{selTrip.to}</bdi>
                </span>
                <span className="text-gray-500">
                  السائق: {selTrip.driver ?? "—"}
                </span>
                <span className="text-gray-500">
                  العميل: {selTrip.customer}
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{
                      background: selTrip.blocked
                        ? TONE.bad
                        : TONE[selTrip.stage],
                    }}
                  />
                  {selTrip.blocked
                    ? "وثيقة حاجبة منتهية للمركبة أو السائق"
                    : STAGE_LABEL[selTrip.stage]}
                </span>
                <Link
                  href={`/waybills/${selTrip.id}`}
                  className="mt-1 text-xs text-brand-700 hover:underline"
                >
                  فتح الشحنة ←
                </Link>
              </>
            ) : selHub ? (
              <>
                <b className="font-display">{selHub.name}</b>
                <div className="flex justify-between">
                  <span>خارجة منها</span>
                  <span className="tabular-nums">{selHub.out}</span>
                </div>
                <div className="flex justify-between">
                  <span>متجهة إليها</span>
                  <span className="tabular-nums">{selHub.in}</span>
                </div>
                <div className="flex justify-between">
                  <span>تنتظر التحميل</span>
                  <span className="tabular-nums">{selHub.wait}</span>
                </div>
                <div className="flex justify-between">
                  <span>متوقفة لوثيقة</span>
                  <span
                    className={`tabular-nums ${selHub.blocked ? "font-semibold text-st-bad-fg" : ""}`}
                  >
                    {selHub.blocked}
                  </span>
                </div>
                <Link
                  href="/waybills?status=in_transit"
                  className="mt-1 text-xs text-brand-700 hover:underline"
                >
                  الشحنات في الطريق ←
                </Link>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* العرض المبسّط: عند اختياره، ودائماً عند الطباعة */}
      <div className={view === "scene" ? "hidden print:block" : ""}>{list}</div>
      {view === "scene" && (
        <p className="text-[11px] text-gray-400 print:hidden">
          مكان الشاحنة على الطريق تقريبي. اضغط على مدينة أو شاحنة لرؤية
          تفاصيلها.
        </p>
      )}
    </div>
  );
}
