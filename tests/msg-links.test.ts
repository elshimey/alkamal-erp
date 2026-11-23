import { describe, expect, it } from "vitest";
import { msgHasLink, msgSegments } from "@/lib/msg-links";

const links = (t: string) => msgSegments(t).filter((s) => s.href).map((s) => [s.text, s.href]);
const joined = (t: string) => msgSegments(t).map((s) => s.text).join("");

describe("روابط رسائل الخطأ", () => {
  it("اسم صفحة بين «» يصبح رابطها والنص لا يتغير", () => {
    const t = "عهدتها في «سندات صرف تحت المراجعة» حتى تُصرف";
    expect(links(t)).toEqual([["«سندات صرف تحت المراجعة»", "/payments/review"]]);
    expect(joined(t)).toBe(t);
  });

  it("عبارات التوجيه المعروفة", () => {
    expect(links("هذا المصروف من مصروفات السائق؛ يُعدَّل من شاشة المصروفات")).toEqual([["شاشة المصروفات", "/expenses"]]);
    expect(links("قيد إهلاك؛ ألغه من صفحة الأصول الثابتة")).toEqual([["صفحة الأصول الثابتة", "/fixed-assets"]]);
    expect(links("المورد «x» موقوف؛ فعّله من شجرة الحسابات")).toEqual([["شجرة الحسابات", "/accounts"]]);
    expect(links("الفترة 11 / 2026 مقفلة")).toEqual([["الفترة 11 / 2026 مقفلة", "/periods"]]);
  });

  it("رقم المستند يفتح المستند نفسه", () => {
    expect(links("الشحنة WB-2026-000012 معتمدة؛ أرجعها لمسودة أولاً")).toEqual([["WB-2026-000012", "/go/WB-2026-000012"]]);
  });

  it("الرابط الصريح لصفحة مصفّاة، وعدة روابط في رسالة واحدة", () => {
    const t = "مصاريف على العميل لم تُعتمد بعد: تخليص 50. اعتمدها من [سندات صرف تحت المراجعة](/payments/review?tab=charges&invoice=7) ثم أصدر الفاتورة INV-2026-000003";
    expect(links(t)).toEqual([
      ["سندات صرف تحت المراجعة", "/payments/review?tab=charges&invoice=7"],
      ["INV-2026-000003", "/go/INV-2026-000003"],
    ]);
    expect(joined(t)).not.toContain("](");
  });

  it("لا رابط خارجي ولا قيمة بين «» ليست صفحة", () => {
    expect(msgHasLink("[x](//evil.com) و«لم يُدفع بعد» و«ا ب ج 1234»")).toBe(false);
    expect(msgSegments("تم الحفظ")).toEqual([{ text: "تم الحفظ" }]);
  });
});
