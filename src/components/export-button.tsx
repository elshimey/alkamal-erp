"use client";

// تصدير جداول التقرير المعروضة إلى ملف CSV يفتح في Excel بالعربية
export function ExportButton({ filename, label = "تصدير Excel" }: { filename: string; label?: string }) {
  const run = () => {
    const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table[data-report]"));
    const q = (v: string) => `"${v.replace(/\s+/g, " ").trim().replace(/"/g, '""')}"`;
    const lines: string[] = [];
    for (const t of tables) {
      if (t.dataset.report) lines.push(q(t.dataset.report));
      // عمود «م» كما يظهر في التقرير (نفس قاعدة globals.css): يُرقَّم سطر البيانات فقط
      const serial = t.dataset.noserial === undefined;
      let n = 0;
      for (const tr of Array.from(t.rows)) {
        const cells = Array.from(tr.cells).map((c) => q(c.innerText));
        if (serial) {
          const head = tr.parentElement?.tagName === "THEAD";
          const data = !head && !tr.matches(".font-bold, .font-semibold, [data-noserial]") && !tr.querySelector(":scope > td[colspan]");
          cells.unshift(q(head ? (tr === t.tHead?.rows[0] ? "م" : "") : data ? String(++n) : ""));
        }
        lines.push(cells.join(","));
      }
      lines.push("");
    }
    const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <button type="button" onClick={run} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 print:hidden">
      {label}
    </button>
  );
}
