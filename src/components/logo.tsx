// شعار البرنامج: طريق بخط متقطع يتجه للأمام داخل شارة سداسية (شكل لوحة الطرق)
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 2 36 11v18L20 38 4 29V11Z" fill="#e9a100" />
      <path d="M15 33 18.5 9h3L25 33Z" fill="#1b2126" />
      <path d="M19.4 13h1.2l.4 4h-2Zm-.5 7h2.2l.4 5h-3Z" fill="#e9a100" />
    </svg>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <div className="leading-tight">
        <div className={`text-lg font-bold ${light ? "text-white" : "text-brand-900"}`}>الكمال للنقليات</div>
        <div className={`text-[11px] tracking-wide ${light ? "text-white/55" : "text-gray-500"}`}>نظام إدارة النقل والحسابات</div>
      </div>
    </div>
  );
}
