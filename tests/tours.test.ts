// دليل الاستخدام: كل جولة سليمة البناء (بنود في شاشات موجودة، خانات تنتظر ملأها بعنوانها،
// وزر «كيف أعمل هذا؟» يجد جولة كل شاشة). ظهور البنود فعلاً في الشاشات يختبره e2e/tours.spec.ts.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { matchPath, TOUR_GROUPS, TOURS, toursForPath } from "@/data/tours";

const pageExists = (p: string) => fs.existsSync(`src/app/(app)${p === "/" ? "" : p}/page.tsx`);

describe("جولات دليل الاستخدام", () => {
  it("36 جولة بمعرفات فريدة في الأقسام المعتمدة", () => {
    expect(TOURS.length).toBe(36);
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
    for (const t of TOURS) expect(TOUR_GROUPS).toContain(t.group);
    for (const g of TOUR_GROUPS) expect(TOURS.some((t) => t.group === g)).toBe(true);
  });

  it("كل خطوة في شاشة موجودة، ورابطها يفتح نفس الشاشة", () => {
    for (const t of TOURS)
      for (const s of t.steps) {
        expect(pageExists(s.path), `${t.id}: ${s.path}`).toBe(true);
        if (s.href) expect(matchPath(s.path, s.href.split("?")[0]), `${t.id}: ${s.href}`).toBe(true);
      }
  });

  it("خطوة الخانة تنتظر خانة بعنوانها، وخطوة الضغط لها بند", () => {
    for (const t of TOURS)
      for (const s of t.steps) {
        if (s.advance === "fill") expect(s.target?.field, `${t.id}: ${s.title}`).toBeTruthy();
        if (s.advance === "click") expect(s.target, `${t.id}: ${s.title}`).toBeTruthy();
      }
  });

  it("كل شاشة في الجولة لها زر «كيف أعمل هذا؟» يبدأ من خطوتها", () => {
    for (const t of TOURS)
      for (const screen of t.screens) {
        expect(pageExists(screen), `${t.id}: ${screen}`).toBe(true);
        const found = toursForPath(screen.replace("[id]", "7")).find((x) => x.tour.id === t.id);
        expect(found, `${t.id}: ${screen}`).toBeTruthy();
      }
    expect(toursForPath("/waybills").map((x) => x.tour.id)).toContain("shipment");
  });
});
