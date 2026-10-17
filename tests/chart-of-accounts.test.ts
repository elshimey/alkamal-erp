import { describe, expect, it } from "vitest";
import { CHART_OF_ACCOUNTS, resolveChart } from "@/data/chart-of-accounts";

describe("شجرة الحسابات", () => {
  const byCode = new Map(CHART_OF_ACCOUNTS.map((a) => [a.code, a]));

  it("الرموز فريدة ولكل حساب أب موجود", () => {
    expect(byCode.size).toBe(CHART_OF_ACCOUNTS.length);
    for (const a of CHART_OF_ACCOUNTS) {
      if (a.parentCode) expect(byCode.has(a.parentCode), a.code).toBe(true);
    }
  });

  it("الأقسام السبعة في المستوى الأول", () => {
    expect(CHART_OF_ACCOUNTS.filter((a) => a.level === 1).map((a) => a.code)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("الحسابات التي تحتها فروع تجميعية", () => {
    expect(byCode.get("1101")!.isPostable).toBe(false);
    expect(byCode.get("110101")!.isPostable).toBe(true);
    expect(byCode.get("1103")!.isPostable).toBe(true);
    expect(byCode.get("11")!.isPostable).toBe(false);
  });

  it("الحسابات المقابلة عكس طبيعة قسمها", () => {
    expect(byCode.get("1202")!.normalBalance).toBe("credit");
    expect(byCode.get("1104")!.normalBalance).toBe("credit");
    expect(byCode.get("4105")!.normalBalance).toBe("debit");
    expect(byCode.get("4101")!.normalBalance).toBe("credit");
    expect(byCode.get("2101")!.normalBalance).toBe("credit");
  });

  it("تكاليف التشغيل تتطلب مركز تكلفة (المركبة)", () => {
    expect(byCode.get("5101")!.requiresCostCenter).toBe(true);
    expect(byCode.get("6101")!.requiresCostCenter).toBe(false);
  });

  it("صندوق الدينار بعملة الدينار", () => {
    expect(byCode.get("110103")!.currency).toBe("KWD");
  });

  it("يرفض حساباً بلا أب", () => {
    expect(() => resolveChart([{ code: "1", nameAr: "أ" }, { code: "1201", nameAr: "ب" }])).toThrow();
  });
});
