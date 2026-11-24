// «مصدر الرقم» (طلب أحمد 2026-11-24): كل رقم في الرئيسية والتقارير يفتح ما حُسب منه،
// والرقم المحسوب يفتح نافذة معادلته أولاً. البيانات: قيد إيراد 1500 على مركبة الاختبار من seed.ts.
import { expect, test, type Page } from "@playwright/test";
import { officeLogin } from "./helpers";

const year = new Date().getFullYear();

async function expectMatch(page: Page) {
  await page.waitForURL(/\/reports\/source/);
  const banner = page.locator("[data-source-match]");
  await expect(banner).toHaveAttribute("data-source-match", "yes");
  await expect(banner).toContainText("يساوي الرقم الذي نقرته");
}

/** مكان النافذة بعد انتهاء حركة دخولها. */
async function settledBox(page: Page) {
  const drawer = page.getByRole("dialog", { name: "من أين جاء هذا الرقم؟" });
  await expect(drawer).toBeVisible();
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return (await drawer.boundingBox())!;
}

async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
}

test.describe("الكمبيوتر", () => {
  test.use({ viewport: { width: 1366, height: 860 } });

  test("مربع الإيرادات يفتح قيوده، ومجمل الربح يفتح معادلته وتُغلق بكل الطرق", async ({ page }) => {
    test.setTimeout(90_000);
    await officeLogin(page);
    await page.goto("/?p=year");
    await page.getByRole("link", { name: /الإيرادات المفوترة/ }).click();
    await expectMatch(page);
    await expect(page.locator("main")).toContainText("إيراد اختبار مصدر الرقم");

    // «رجوع» يعود للرئيسية
    await page.getByRole("button", { name: "→ رجوع" }).click();
    await page.waitForURL((u) => u.pathname === "/");

    const gross = page.getByRole("button", { name: /مجمل الربح/ }).first();
    const drawer = page.getByRole("dialog", { name: "من أين جاء هذا الرقم؟" });
    // Esc
    await gross.click();
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("الإيرادات");
    await expect(drawer).toContainText("تكاليف التشغيل");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    // ×
    await gross.click();
    await drawer.getByRole("button", { name: "إغلاق" }).first().click();
    await expect(drawer).toBeHidden();
    // النقر خارجها (يمين الشاشة، والنافذة على اليسار)
    await gross.click();
    await expect(drawer).toBeVisible();
    await page.mouse.click(1300, 400);
    await expect(drawer).toBeHidden();
    // النافذة داخل الشاشة لا تغطيها شيء آخر
    await gross.click();
    const box = await settledBox(page);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1366);
    // سطر الإيرادات في المعادلة يفتح قيوده
    await drawer.getByRole("link", { name: /الإيرادات/ }).first().click();
    await expectMatch(page);
  });

  test("صافي الربح: معادلة داخل معادلة بزر رجوع، وقائمة الدخل تفتح قيود كل حساب", async ({ page }) => {
    test.setTimeout(90_000);
    await officeLogin(page);
    await page.goto(`/reports/income?from=${year}-01-01&to=${year}-12-31`);
    await page.locator("main table").getByRole("button", { name: /\d/ }).last().click();
    const drawer = page.getByRole("dialog", { name: "من أين جاء هذا الرقم؟" });
    await expect(drawer).toContainText("صافي الربح");
    await drawer.getByRole("button", { name: /الربح قبل الزكاة/ }).click();
    await expect(drawer.getByRole("heading")).toContainText("الربح قبل الزكاة");
    await drawer.getByRole("button", { name: "رجوع" }).click();
    await expect(drawer.getByRole("heading")).toContainText("صافي الربح");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    // حساب 4101 في قائمة الدخل
    await page.locator("main table tr", { hasText: "4101" }).getByRole("link").first().click();
    await expectMatch(page);
  });

  test("ميزان المراجعة والمركز المالي: كل رقم يطابق قيوده", async ({ page }) => {
    test.setTimeout(90_000);
    await officeLogin(page);
    await page.goto(`/reports/trial-balance?from=${year}-01-01&to=${year}-12-31`);
    await page.locator("main table tr", { hasText: "إيراد النقل الداخلي" }).locator("a.drill").last().click();
    await expectMatch(page);

    await page.goto(`/reports/balance-sheet?to=${year}-12-31`);
    await page.locator("main a.drill-card").first().click();
    await expectMatch(page);
  });
});

test.describe("الجوال", () => {
  test.use({ viewport: { width: 400, height: 850 }, isMobile: true, hasTouch: true });

  test("المعادلة تصعد من الأسفل دون سحب جانبي، وصفحة المصدر بلا سحب جانبي", async ({ page }) => {
    test.setTimeout(90_000);
    await officeLogin(page);
    await page.goto("/?p=year");
    await page.getByRole("button", { name: /مجمل الربح/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "من أين جاء هذا الرقم؟" });
    const box = await settledBox(page);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.width).toBeLessThanOrEqual(400);
    expect(box.y + box.height).toBeLessThanOrEqual(851);
    await noSideScroll(page);
    await drawer.getByRole("link", { name: /الإيرادات/ }).first().click();
    await expectMatch(page);
    await noSideScroll(page);
  });
});
