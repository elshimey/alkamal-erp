import type { ComponentProps, ReactNode } from "react";

export const fmt = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Section({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="animate-rise mb-4 rounded-2xl bg-white p-4 shadow-[0_4px_16px_-8px_rgba(27,33,38,0.12)]">
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-asphalt-900">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function DField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-gray-700">
        {label}
        {hint && <span className="ms-1 text-xs font-normal text-gray-400">({hint})</span>}
      </span>
      {children}
    </label>
  );
}

const control = "w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30 focus:outline-none";

export function DInput(props: ComponentProps<"input">) {
  return <input {...props} className={`${control} ${props.className ?? ""}`} />;
}

export function DSelect(props: ComponentProps<"select">) {
  return <select {...props} className={`${control} ${props.className ?? ""}`} />;
}

export function DTextarea(props: ComponentProps<"textarea">) {
  return <textarea rows={3} {...props} className={`${control} ${props.className ?? ""}`} />;
}

const TONES = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-sky-100 text-sky-800",
  amber: "bg-amber-100 text-amber-900",
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-700",
} as const;

export function Pill({ children, tone = "gray" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

export const STATUS_TONE = { draft: "gray", in_transit: "blue", delivered: "amber", approved: "green", invoiced: "green", rejected: "red" } as const;
