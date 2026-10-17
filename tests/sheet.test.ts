import { describe, expect, it } from "vitest";
import { parseDelimited, toCsv } from "@/lib/sheet";

describe("قراءة الصفوف الملصوقة", () => {
  it("يقرأ لصقاً من Excel مفصولاً بـ Tab", () => {
    expect(parseDelimited("أ ب ج 1\tCH1\n د 2\tCH2\r\n", "\t")).toEqual([
      ["أ ب ج 1", "CH1"],
      [" د 2", "CH2"],
    ]);
  });
  it("يقرأ CSV بخلايا بين علامتي تنصيص ويتجاهل الصفوف الفارغة", () => {
    expect(parseDelimited('اسم,"عنوان, الرياض"\n,\n"قال ""نعم""",2', ",")).toEqual([
      ["اسم", "عنوان, الرياض"],
      ['قال "نعم"', "2"],
    ]);
  });
  it("القالب يعود كما هو", () => {
    const rows = [["اللوحة", "الملاحظة, الأولى"]];
    expect(parseDelimited(toCsv(rows), ",")).toEqual(rows);
  });
});
