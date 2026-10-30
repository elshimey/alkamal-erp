"use client";

import { useState } from "react";
import { joinPlate, splitPlate } from "@/lib/plates";

/** اللوحة في خانتين: الأحرف والأرقام، وتُحفظ مجمّعة «أ ب ج 1234». */
export function PlateInput({ defaultValue }: { defaultValue?: string | null }) {
  const init = splitPlate(defaultValue);
  const [letters, setLetters] = useState(init.letters);
  const [numbers, setNumbers] = useState(init.numbers);
  const cell = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";
  const shown = joinPlate(letters, numbers);
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">الأحرف</span>
          <input name="plateLetters" value={letters} onChange={(e) => setLetters(e.target.value.replace(/[0-9٠-٩]/g, ""))} required placeholder="أ ب ج" className={cell} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] text-gray-500">الأرقام</span>
          <input name="plateNumbers" value={numbers} onChange={(e) => setNumbers(e.target.value.replace(/[^0-9٠-٩]/g, ""))} required inputMode="numeric" dir="ltr" placeholder="1234" className={cell} />
        </label>
      </div>
      {shown && <span className="text-xs text-gray-500">تُحفظ: «{shown}»</span>}
    </div>
  );
}
