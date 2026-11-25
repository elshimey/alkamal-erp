// ثابت (نص أو كائن) يُصدَّر من ملف "use client" يصل لصفحة الخادم مرجعاً لا قيمته،
// فيظهر مكانه نص خطأ (كما حدث لـ cardShell فظهرت بطاقات الجوال دون شكلها).
// هذا الفحص يمنع أن تستورد صفحة خادم ثابتاً من ملف عميل؛ ضع الثابت في ملف عادي.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

const files = walk("src");
const isClient = (src: string) => /^\s*["']use client["']/.test(src);
const modId = (f: string) => f.replace(/^src\//, "@/").replace(/\.(ts|tsx)$/, "").replace(/\/index$/, "");

describe("ثوابت ملفات العميل لا تُستورد في صفحات الخادم", () => {
  it("لا صفحة خادم تستورد ثابتاً من ملف use client", () => {
    const bad: string[] = [];
    const consts = new Map<string, string[]>();
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (!isClient(src)) continue;
      const names = [...src.matchAll(/^export const (\w+)\s*(?::[^=]+)?=\s*["'`{[\d]/gm)].map((m) => m[1]);
      if (names.length) consts.set(modId(f), names);
    }
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (isClient(src)) continue;
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
        let mod = m[2];
        if (mod.startsWith(".")) mod = modId(path.join(path.dirname(f), mod).replace(/\\/g, "/") + ".ts");
        const names = consts.get(mod);
        if (!names) continue;
        for (const n of m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]))
          if (names.includes(n)) bad.push(`${f}: ${n} من ${mod}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
