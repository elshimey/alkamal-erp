import { describe, expect, it } from "vitest";
import { amountInWords, numberToArabicWords } from "@/lib/tafqit";

describe("التفقيط", () => {
  it("الأعداد", () => {
    expect(numberToArabicWords(0)).toBe("صفر");
    expect(numberToArabicWords(15)).toBe("خمسة عشر");
    expect(numberToArabicWords(21)).toBe("واحد وعشرون");
    expect(numberToArabicWords(250)).toBe("مائتان وخمسون");
    expect(numberToArabicWords(1000)).toBe("ألف");
    expect(numberToArabicWords(2000)).toBe("ألفان");
    expect(numberToArabicWords(5750)).toBe("خمسة آلاف وسبعمائة وخمسون");
    expect(numberToArabicWords(15000)).toBe("خمسة عشر ألف");
    expect(numberToArabicWords(1_250_300)).toBe("مليون ومائتان وخمسون ألف وثلاثمائة");
  });
  it("المبالغ بالعملة", () => {
    expect(amountInWords(1500.5)).toBe("فقط ألف وخمسمائة ريال سعودي وخمسون هللة لا غير");
    expect(amountInWords(3, "KWD")).toBe("فقط ثلاثة دينار كويتي لا غير");
    expect(amountInWords(0.25, "KWD")).toBe("فقط صفر دينار كويتي ومائتان وخمسون فلس لا غير");
  });
});
