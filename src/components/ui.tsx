import type { ComponentProps, ReactNode } from "react";

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold text-brand-900">
          <span className="h-7 w-1.5 rounded-full bg-brand-600" />
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl ps-4.5 text-sm leading-relaxed text-gray-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_2px_rgba(27,33,38,0.04),0_4px_16px_-8px_rgba(27,33,38,0.08)] ${className}`}>
      {title && <h2 className="mb-4 text-base font-semibold text-brand-900">{title}</h2>}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

const inputClass =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-600 focus:ring-3 focus:ring-brand-100";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-white shadow-[0_4px_16px_-8px_rgba(27,33,38,0.08)]">
      <table className="w-full text-sm">
        <thead className="bg-asphalt-900 text-white/85">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 text-start font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 [&>tr]:transition-colors [&>tr:hover]:bg-brand-50/60">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>;
}

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "blue" | "amber" | "red" }) {
  const tones = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-green-100 text-green-800",
    blue: "bg-sky-100 text-sky-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-gray-400">
        {children}
      </td>
    </tr>
  );
}
