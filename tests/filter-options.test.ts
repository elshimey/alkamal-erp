import { describe, expect, it } from "vitest";
import { filterOptions, norm } from "@/lib/filter-options";

const opts = [
  "شركة المراعي",
  "مصنع المراعي – الدمام",
  "الدمام ← الرياض",
  "مؤسسة الإطارات الحديثة",
  "ينبع / الميناء",
].map((label, i) => ({ value: String(i), label }));
const labels = (q: string) => filterOptions(opts, q).map((o) => o.label);

describe("البحث في قوائم الاختيار", () => {
  it("يتجاهل الهمزات والتاء المربوطة والتشكيل", () => {
    expect(norm("مؤسسةُ الإطارات")).toBe(norm("مؤسسه الاطارات"));
    expect(labels("الاطارات")).toEqual(["مؤسسة الإطارات الحديثة"]);
  });
  it("ما يبدأ بالحروف المكتوبة (أو تبدأ به إحدى كلماته) يأتي قبل ما يحتويها", () => {
    expect(labels("الدمام")).toEqual([
      "الدمام ← الرياض",
      "مصنع المراعي – الدمام",
    ]);
    expect(labels("مرا")).toEqual(["شركة المراعي", "مصنع المراعي – الدمام"]);
    expect(labels("المرا")).toEqual(["شركة المراعي", "مصنع المراعي – الدمام"]);
    expect(labels("الميناء")).toEqual(["ينبع / الميناء"]);
  });
  it("البحث الفارغ يعيد القائمة كلها", () => {
    expect(labels("")).toHaveLength(opts.length);
  });
});
