// أساسيات الشكل (الخطوة 2 من خطة الشكل): مسار الصفحة، ولوحة الجرس على الجوال، والجداول العريضة.
import { expect, test, type Page } from "@playwright/test";
import { E2E } from "./data";
import { officeLogin } from "./helpers";

const phone = { locale: "ar", timezoneId: "Asia/Riyadh", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("الكمبيوتر: مسار الصفحة في الشريط العلوي يصل للقائمة الأم", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/payments/review");
  const crumbs = page.getByRole("navigation", { name: "مسار الصفحة" });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText("سندات صرف تحت المراجعة");
  await crumbs.getByRole("link", { name: "سندات الصرف" }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText("سندات الصرف");
  // التقرير: «التقارير» رابط لمركز التقارير، ولا يتكرر اسم القسم
  await page.goto("/reports/trial-balance");
  await expect(crumbs.getByRole("link", { name: "التقارير" })).toHaveAttribute("href", "/reports");
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText("ميزان المراجعة");
});

test("الجوال: رأس الشاشة بزر رجوع، والجرس يصعد من الأسفل ويُغلق بكل الطرق، ولا سحب جانبي للصفحة", async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await officeLogin(page, { company: E2E.company, ...E2E.admin });

  await page.goto("/reports/trial-balance");
  const back = page.getByRole("link", { name: "رجوع إلى التقارير" });
  await expect(back).toBeVisible();
  await expect(page.locator("header b", { hasText: "ميزان المراجعة" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await back.click();
  await expect(page).toHaveURL(/\/reports$/);

  // لوحة الجرس: كاملة داخل الشاشة، ونصوصها لا تُقص
  await page.goto("/");
  const bell = page.getByRole("button", { name: /^التنبيهات/ });
  const sheet = page.getByRole("dialog", { name: "التنبيهات" });
  for (const close of ["esc", "backdrop", "x"] as const) {
    await bell.click();
    await expect(sheet).toBeVisible();
    // بعد انتهاء حركة الصعود: اللوحة كلها داخل الشاشة وملتصقة بأسفلها
    await expect.poll(async () => Math.round(((await sheet.boundingBox())?.y ?? 0) + ((await sheet.boundingBox())?.height ?? 0))).toBe(844);
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 1);
    expect(box.y).toBeGreaterThan(0);
    if (close === "esc") await page.keyboard.press("Escape");
    else if (close === "backdrop") await page.getByRole("button", { name: "إغلاق التنبيهات" }).click({ position: { x: 20, y: 20 } });
    else await sheet.getByRole("button", { name: "إغلاق" }).click();
    await expect(sheet).toBeHidden();
  }
  await bell.click();
  await sheet.getByRole("tab", { name: /الوثائق/ }).click();
  await expect(sheet.getByRole("tab", { name: /الوثائق/ })).toHaveAttribute("aria-selected", "true");
  await ctx.close();
});
