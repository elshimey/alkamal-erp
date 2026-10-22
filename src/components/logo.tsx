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

/** شعار الشركة المرفوع في بيانات المنشأة، وإلا شعار البرنامج. */
export function BrandMark({ logo, size = 36 }: { logo?: string | null; size?: number }) {
  if (!logo) return <LogoMark size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- الشعار محفوظ كبيانات مضمنة
    <img src={logo} alt="" width={size} height={size} className="shrink-0 rounded-lg bg-white object-contain p-0.5" style={{ width: size, height: size }} />
  );
}

export function Logo({ light = false, name, logo }: { light?: boolean; name: string; logo?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <BrandMark logo={logo} />
      <div className="min-w-0 leading-tight">
        <div className={`line-clamp-2 font-display font-semibold ${name.length > 16 ? "text-base" : "text-lg"} ${light ? "text-white" : "text-brand-900"}`} title={name}>
          {name}
        </div>
        <div className={`text-[11px] tracking-wide ${light ? "text-white/55" : "text-gray-500"}`}>نظام إدارة النقل والحسابات</div>
      </div>
    </div>
  );
}
