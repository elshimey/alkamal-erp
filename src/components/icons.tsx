// أيقونات خطية موحّدة للقائمة واللوحة، مرسومة بلون النص المحيط.
import type { ReactNode } from "react";

const PATHS = {
  home: <path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />,
  truck: (
    <>
      <path d="M2 5h11v11H2Zm11 4h4.5l3.5 4v3h-8Z" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  driver: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 14.5V21M9.6 11.3 3.4 9.6m11 1.7 6.2-1.7" />
    </>
  ),
  handover: <path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5" />,
  document: <path d="M6 3h9l4 4v14H6Zm8 0v5h5M9 13h7m-7 4h5" />,
  waybill: <path d="M9 3h6v3H9ZM7 4.5H5V21h14V4.5h-2M8.5 11h7m-7 4h4.5" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17.5 14.5c2 .3 3.4 1.9 4 4.5" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" strokeDasharray="2.5 2.5" />
    </>
  ),
  contract: <path d="M6 3h9l4 4v14H6Zm8 0v5h5M9 17c1.4-2.2 2.4-2.2 3 0 .6 1.6 1.6 1.2 3-.8" />,
  tree: <path d="M3 4h7v5H3Zm11 6h7v5h-7Zm0 8h7v3h-7ZM6.5 9v10.5H14M6.5 12.5H14" />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9l6.4 6.4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4.2-6 8-6s7 2 8 6" />
    </>
  ),
  shield: <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6Zm-3 9 2 2 4-4" />,
  ledger: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Zm0 13a3 3 0 0 1 3-3h11" />,
  lock: <path d="M6 11h12v10H6Zm2.5 0V8a3.5 3.5 0 0 1 7 0v3" />,
  logout: <path d="M14 4h5v16h-5M10 8l-4 4 4 4m-4-4h10" />,
  calendar: <path d="M4 6h16v15H4Zm0 5h16M8 3v5m8-5v5" />,
  ticket: <path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4Zm10 0v12m-6-8h3m-3 4h3" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5" />
    </>
  ),
  chat: <path d="M4 20l1.3-3.9A8 8 0 1 1 8 19Zm5-9.5c0 2.5 2 4.5 4.5 4.5l1-1.2 1.8.8-.3 1.6c-3.6.3-7-3.1-6.7-6.7l1.6-.3.8 1.8Z" />,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
  building: <path d="M4 21V5l8-2v18m0-11h8v11M3 21h18M7.5 8h1m-1 3.5h1m-1 3.5h1m7-2h1m-1 3.5h1" />,
  book: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Zm0 15A2.5 2.5 0 0 1 6.5 18H20v3H6.5M8 7.5h8M8 11h5" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Zm6.5 11 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" />,
  alert: <path d="M12 3 2 20h20Zm0 6v5m0 3v.5" />,
  invoice: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Zm3 5h6m-6 4h6m-6 4h3" />,
  cash: <path d="M3 7h18v10H3Zm9 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6 10v4m12-4v4" />,
  exchange: <path d="M4 8h13l-3-3m6 11H7l3 3" />,
  fuel: <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h12M7 8h6m2 2 3 2v6a1.5 1.5 0 0 0 3 0V9l-3-3" />,
  chart: <path d="M4 20V4m0 16h16M8 16v-4m4 4V8m4 8v-6" />,
  search: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4" />,
  list: <path d="M4 5h16v14H4Zm0 4.5h16M4 14h16M9 9.5V19" />,
  grid: <path d="M4 4h16v16H4Zm0 5.3h16M4 14.7h16M9.3 4v16m5.4-16v16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  expand: <path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5" />,
  wrench: <path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 1-2-2Z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** شاحنة جانبية تتجه يساراً (اتجاه السير في الواجهة العربية). */
export function Truck({ className = "w-16", spinning = false }: { className?: string; spinning?: boolean }) {
  const wheel = (cx: number) => (
    <g key={cx} className={spinning ? "spin-wheel" : undefined} style={{ transformBox: "fill-box" }}>
      <circle cx={cx} cy="25" r="4.2" fill="#1b2126" />
      <circle cx={cx} cy="25" r="1.6" fill="#c9ced2" />
      <path d={`M${cx} 21.6v1.4`} stroke="#c9ced2" strokeWidth="0.9" />
    </g>
  );
  return (
    <svg viewBox="0 0 72 30" className={className} aria-hidden="true">
      {/* المقطورة */}
      <rect x="22" y="3" width="48" height="18" rx="1.5" fill="#e9a100" />
      <path d="M26 8h40" stroke="#1b2126" strokeWidth="1.4" strokeDasharray="5 3.5" opacity="0.55" />
      <rect x="22" y="19" width="48" height="2" fill="#8a5c00" />
      {/* القمرة */}
      <path d="M3 21v-7.5L8.5 6H20v15Z" fill="#303a42" />
      <path d="M6 13 10 8h6.5v5Z" fill="#9fd3e6" />
      <rect x="2" y="17" width="3" height="2" rx="0.5" fill="#f5b82e" />
      <rect x="3" y="21" width="67" height="1.6" fill="#1b2126" />
      {[11, 48, 61].map(wheel)}
    </svg>
  );
}
