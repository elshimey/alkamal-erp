import { expect, test } from "@playwright/test";
import { E2E } from "./data";

// صفحة دخول واحدة تعرف الحساب، وزر «أنا سائق»، والتطبيق المثبّت يتذكر جوال السائق
const phone = { locale: "ar", timezoneId: "Asia/Riyadh", viewport: { width: 400, height: 850 }, isMobile: true, hasTouch: true };

async function fill(page: import("@playwright/test").Page, who: { login: string; password: string }) {
  await page.getByRole("textbox", { name: /رمز الشركة/ }).fill(E2E.company);
  await page.getByRole("textbox", { name: /اسم الدخول/ }).fill(who.login);
  await page.getByRole("textbox", { name: /كلمة المرور/ }).fill(who.password);
  await page.getByRole("button", { name: "دخول" }).click();
}

test("السائق يدخل من صفحة المكتب فيفتح تطبيقه، ويفتح التطبيق بعدها على رحلاته مباشرة", async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("link", { name: /أنا سائق/ })).toBeVisible();
  await fill(page, E2E.driver);
  await page.waitForURL((u) => u.pathname.startsWith("/driver") && !u.pathname.startsWith("/driver/login"));

  // فتح التطبيق المثبّت من جديد (رابط البرنامج) يصل لتطبيق السائق لا لدخول المكتب
  await page.goto("/");
  await page.waitForURL((u) => u.pathname.startsWith("/driver") && !u.pathname.startsWith("/driver/login"));

  // بعد الخروج يبقى الجوال جوال سائق: يفتح دخول السائق بلغته، ومنه رابط لدخول المكتب
  await ctx.clearCookies({ name: "erp_driver_session" });
  await page.goto("/");
  await expect(page).toHaveURL(/\/driver\/login/);
  await page.getByRole("link", { name: /موظف مكتب/ }).click();
  await expect(page).toHaveURL(/\/login\?office=1/);
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await ctx.close();
});

test("موظف المكتب يدخل من صفحة السائق فيفتح البرنامج", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "ar" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByRole("link", { name: /أنا سائق/ }).click();
  await expect(page).toHaveURL(/\/driver\/login/);
  await fill(page, E2E.admin);
  await page.waitForURL((u) => !u.pathname.startsWith("/driver") && !u.pathname.startsWith("/login"));
  await page.goto("/login");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await ctx.close();
});
