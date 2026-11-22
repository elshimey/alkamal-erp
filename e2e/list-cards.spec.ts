// بطاقات باقي القوائم على الجوال (خطة الشكل، الخطوة 3 الجزء الثاني): كل قائمة بطاقات دون سحب جانبي،
// ولمس البطاقة يفتح معاينتها من الأسفل وتُغلق بـ× وEsc والنقر خارجها، والكمبيوتر يبقى جدولاً.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { officeLogin } from "./helpers";

const phone = { locale: "ar", timezoneId: "Asia/Riyadh", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const LISTS = ["/drivers", "/vehicles", "/assignments", "/routes", "/parties", "/employees", "/payments", "/expenses", "/violations", "/hr/custody", "/hr/advances", "/payroll", "/contracts"];

test("الجوال: كل القوائم بطاقات دون سحب جانبي، والمعاينة تُغلق بكل الطرق", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await officeLogin(page);
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  for (const path of LISTS) {
    await page.goto(path);
    await expect(page.locator("[data-doc-cards]").first(), path).toBeVisible();
    await expect(page.locator("main table").first(), path).toBeHidden();
    expect(await noSideScroll(), path).toBe(true);
  }

  // السائق والمركبة والمسار من بيانات الاختبار: لمس البطاقة يفتح معاينتها
  for (const [path, name] of [["/drivers", E2E.driver.name], ["/vehicles", null], ["/routes", null]] as const) {
    await page.goto(path);
    const card = name ? page.locator("[data-tap-card]", { hasText: name }) : page.locator("[data-tap-card]").first();
    await expect(card, path).toBeVisible();
    for (const close of ["esc", "x", "backdrop"] as const) {
      await card.click();
      const sheet = page.getByRole("dialog");
      await expect(sheet, path).toBeVisible();
      expect(await noSideScroll(), path).toBe(true);
      if (close === "esc") await page.keyboard.press("Escape");
      else if (close === "x") await sheet.getByRole("button", { name: "إغلاق المعاينة" }).click();
      else await page.mouse.click(195, 30);
      await expect(sheet, `${path} ${close}`).toBeHidden();
    }
  }

  // زر في المعاينة يعمل: «تعديل البيانات» يفتح نافذة السائق
  await page.goto("/drivers");
  await page.locator("[data-tap-card]", { hasText: E2E.driver.name }).click();
  await page.getByRole("dialog").getByRole("link", { name: "تعديل البيانات" }).click();
  await expect(page).toHaveURL(/[?&]edit=/);

  // العقد بطاقة تفتح صفحته
  await page.goto("/contracts");
  await page.locator("[data-doc-cards] > a", { hasText: "E2E-1" }).click();
  await expect(page).toHaveURL(/\/contracts\/\d+/);
  await ctx.close();
});

test("الكمبيوتر: القوائم تبقى جدولاً دون بطاقات", async ({ page }) => {
  await officeLogin(page);
  for (const path of ["/drivers", "/payments", "/hr/custody"]) {
    await page.goto(path);
    await expect(page.locator("main table").last(), path).toBeVisible();
    await expect(page.locator("[data-doc-cards]").first(), path).toBeHidden();
  }
});
