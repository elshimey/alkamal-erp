"use client";

import { useRef, useState } from "react";

const MAX = 300 * 1024;

/** رفع الشعار: يُقرأ في المتصفح ويُرسل مع النموذج كرابط بيانات. */
export function LogoInput({ initial }: { initial: string | null }) {
  const [logo, setLogo] = useState(initial ?? "");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-4">
      <input type="hidden" name="logo" value={logo} />
      <button
        type="button"
        onClick={() => file.current?.click()}
        className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 text-xs text-gray-400 transition hover:border-brand-500 hover:bg-brand-50"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo ? <img src={logo} alt="الشعار" className="size-full object-contain p-2" /> : "اضغط لرفع الشعار"}
      </button>
      <div className="text-sm">
        <div className="flex gap-2">
          <button type="button" onClick={() => file.current?.click()} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-50">
            {logo ? "تغيير الشعار" : "رفع الشعار"}
          </button>
          {logo && (
            <button type="button" onClick={() => setLogo("")} className="rounded-lg px-3 py-1.5 text-red-600 hover:bg-red-50">
              إزالة
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-gray-400">PNG أو JPG أو SVG، حتى 300 كيلوبايت. يظهر في رأس الفواتير.</p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > MAX) return setError("حجم الصورة أكبر من 300 كيلوبايت");
          setError("");
          const r = new FileReader();
          r.onload = () => setLogo(String(r.result));
          r.readAsDataURL(f);
        }}
      />
    </div>
  );
}
