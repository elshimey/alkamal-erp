"use client";

import { useEffect, useRef, useState } from "react";

const MAX_PDF = 5_000_000;

/** مرفق الوثيقة: صورة (تُضغط في المتصفح) أو PDF، يُرسل كنص في حقل مخفي مع النموذج. */
export function DocumentFileInput({ name = "file", label = "إرفاق صورة أو PDF" }: { name?: string; label?: string }) {
  const [data, setData] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // يُفرَّغ المرفق عند تفريغ النموذج بعد الحفظ
  useEffect(() => {
    const form = ref.current?.closest("form");
    const clear = () => {
      setData("");
      setFileName("");
      setError("");
    };
    form?.addEventListener("reset", clear);
    return () => form?.removeEventListener("reset", clear);
  }, []);

  const pick = async (file: File | undefined) => {
    setError("");
    if (!file) return;
    setBusy(true);
    try {
      if (file.type === "application/pdf") {
        if (file.size > MAX_PDF) throw new Error("ملف PDF أكبر من 5 ميجابايت");
        const url = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error("تعذّرت قراءة الملف"));
          r.readAsDataURL(file);
        });
        setData(url);
      } else if (file.type.startsWith("image/")) {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        setData(canvas.toDataURL("image/jpeg", 0.8));
      } else throw new Error("اختر صورة أو ملف PDF");
      setFileName(file.name);
    } catch (e) {
      setData("");
      setFileName("");
      setError(e instanceof Error ? e.message : "تعذّرت قراءة الملف");
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="flex flex-col gap-1">
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:border-brand-500 hover:bg-brand-50">
        <span aria-hidden>📎</span>
        <span className="truncate">{busy ? "جارٍ التجهيز…" : fileName || label}</span>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      <input type="hidden" name={name} value={data} />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
