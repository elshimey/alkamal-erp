// البحث بـ ilike على عمود رقمي (المبلغ) يرمي «operator does not exist: numeric ~~* unknown»
// فتتعطل صفحة القائمة كلها عند البحث (حدث في المصروفات وسندات الصرف).
// هذا الفحص يمنع أي ilike مباشر على عمود غير نصي؛ العمود الرقمي يُبحث فيه بـ sql`${col}::text`.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/db/schema";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

const TEXT = new Set(["PgText", "PgVarchar", "PgChar"]);

describe("البحث النصي على أعمدة نصية فقط", () => {
  it("لا ilike مباشر على عمود رقمي أو تاريخ", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const f of walk("src")) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bilike\(\s*s\.(\w+)\.(\w+)/g)) {
        const col = (schema as unknown as Record<string, Record<string, { columnType?: string }>>)[m[1]]?.[m[2]];
        if (!col) continue;
        checked++;
        if (!TEXT.has(col.columnType ?? "")) bad.push(`${f}: s.${m[1]}.${m[2]} (${col.columnType})`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(bad).toEqual([]);
  });
});
