// الأمان من المتصفح: كل شركة ترى بياناتها فقط، والتلاعب بملفات المتصفح لا يفتح شركة أخرى.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { driverPhone, officeLogin } from "./helpers";

const beta = { company: E2E.beta.code, login: E2E.beta.login, password: E2E.beta.password };

test("بلا دخول: الشاشات تعيد لصفحة الدخول", async ({ page }) => {
  for (const path of ["/", "/invoices", "/expenses", "/accounts", "/users"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("شركة بيتا لا ترى عملاء الكمال، والكمال لا ترى عملاء بيتا", async ({ page, browser }) => {
  await officeLogin(page, beta);
  await page.goto("/customers");
  await expect(page.getByText(E2E.beta.secretCustomer).first()).toBeVisible();
  await expect(page.getByText(E2E.customer)).toHaveCount(0);
  // فتح فاتورة الكمال برقمها من داخل بيتا لا يعرض شيئاً منها
  await page.goto("/invoices?open=1");
  await expect(page.getByText(E2E.customer)).toHaveCount(0);

  const home = await (await browser.newContext({ locale: "ar" })).newPage();
  await officeLogin(home);
  await home.goto("/customers");
  await expect(home.getByText(E2E.customer).first()).toBeVisible();
  await expect(home.getByText(E2E.beta.secretCustomer)).toHaveCount(0);
  await home.context().close();
});

test("تغيير ملف الشركة في المتصفح لا يفتح شركة أخرى بجلسة بيتا", async ({ page, context }) => {
  await officeLogin(page, beta);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "erp_tenant")?.value).toBe("t_beta");
  // المهاجم يغيّر ملف الشركة إلى الكمال ويبقي جلسة بيتا
  await context.addCookies(cookies.filter((c) => c.name === "erp_tenant").map((c) => ({ ...c, value: "public" })));
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/login/);
  // وقيمة مصنوعة لحقن SQL في ملف الشركة لا تكسر شيئاً
  await context.addCookies(cookies.filter((c) => c.name === "erp_tenant").map((c) => ({ ...c, value: encodeURIComponent('t_beta"; drop schema public cascade; --') })));
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/login/);
});

test("حساب السائق لا يفتح شاشات المكتب", async ({ browser }) => {
  const phone = await driverPhone(browser);
  await phone.goto("/invoices");
  await expect(phone).not.toHaveURL(/\/invoices/);
  await expect(phone.getByText("فواتير المبيعات")).toHaveCount(0);
  await phone.context().close();
});
