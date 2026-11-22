import { describe, expect, it } from "vitest";
import { EXTRA_PAGES, NAV } from "@/data/nav";
import { crumbPages, crumbTrail } from "@/lib/breadcrumb";

const pages = crumbPages(NAV, EXTRA_PAGES);

describe("مسار الصفحة", () => {
  it("القائمة: القسم ثم اسم القائمة بلا رابط", () => {
    expect(crumbTrail("/waybills", pages)).toEqual([{ label: "المبيعات والتشغيل" }, { label: "الشحنات" }]);
  });
  it("المستند: القسم ثم رابط القائمة ثم رقم المستند من عنوان الصفحة", () => {
    expect(crumbTrail("/waybills/63", pages, "WB-2026-000063")).toEqual([
      { label: "المبيعات والتشغيل" },
      { label: "الشحنات", href: "/waybills" },
      { label: "WB-2026-000063" },
    ]);
  });
  it("الشاشة الفرعية تمر بالقائمة الأم", () => {
    expect(crumbTrail("/payments/review", pages)).toEqual([{ label: "المشتريات والمصروفات" }, { label: "سندات الصرف", href: "/payments" }, { label: "سندات صرف تحت المراجعة" }]);
  });
  it("التقارير لا يتكرر اسمها، والتقرير خارج القائمة يأتي من مركز التقارير", () => {
    expect(crumbTrail("/reports/trial-balance", pages)).toEqual([{ label: "التقارير", href: "/reports" }, { label: "ميزان المراجعة" }]);
    expect(crumbTrail("/reports", pages)).toEqual([{ label: "التقارير" }]);
  });
  it("«إضافة شحنة جديدة» في البحث لا تغيّر اسم قائمة الشحنات", () => {
    expect(crumbTrail("/waybills/", pages).at(-1)).toEqual({ label: "الشحنات" });
  });
  it("الرئيسية وصفحة لا يعرفها المسار", () => {
    expect(crumbTrail("/", pages)).toEqual([{ label: "لوحة القيادة" }]);
    expect(crumbTrail("/x/y", pages, "صفحة")).toEqual([{ label: "صفحة" }]);
    expect(crumbTrail("/x/y", pages)).toEqual([]);
  });
});
