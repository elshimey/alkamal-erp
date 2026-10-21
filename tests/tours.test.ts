import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchPath, TOURS } from "@/data/tours";

describe("دليل الدورات", () => {
  it("يطابق المسارات مع [id]", () => {
    expect(matchPath("/waybills/[id]", "/waybills/12")).toBe(true);
    expect(matchPath("/waybills/[id]", "/waybills")).toBe(false);
    expect(matchPath("/invoices", "/invoices/")).toBe(true);
    expect(matchPath("/notes/sales", "/notes/sales/new")).toBe(false);
  });

  it("كل خطوة تشير إلى صفحة موجودة، والمعرفات فريدة", () => {
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
    expect(TOURS).toHaveLength(10);
    for (const t of TOURS) {
      expect(t.steps.length).toBeGreaterThan(1);
      for (const s of t.steps) {
        const dir = s.path.replace(/^\/notes\/sales/, "/notes/[side]");
        expect(existsSync(`src/app/(app)${dir}/page.tsx`), `${t.id}: ${s.path}`).toBe(true);
      }
    }
  });
});
