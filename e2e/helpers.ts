import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E } from "./data";

export const PHOTO = "e2e/fixtures/photo.jpg";

/** اتصال مباشر بقاعدة الاختبار للتأكد من القيود بعد كل دورة (قراءة فقط). */
export const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://erp:erp@localhost:5432/alkamal_erp_e2e", { max: 2, onnotice: () => {} });

export async function officeLogin(page: Page, who: { company: string; login: string; password: string } = { company: E2E.company, ...E2E.admin }) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: /رمز الشركة/ }).fill(who.company);
  await page.getByRole("textbox", { name: /اسم الدخول/ }).fill(who.login);
  await page.getByRole("textbox", { name: /كلمة المرور/ }).fill(who.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** جوال السائق: سياق متصفح منفصل بمقاس الجوال، كما يفتحه السائق. */
export async function driverPhone(browser: Browser) {
  const ctx = await browser.newContext({ locale: "ar", timezoneId: "Asia/Riyadh", viewport: { width: 400, height: 850 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/driver/login");
  await page.getByRole("textbox", { name: "رمز الشركة" }).fill(E2E.company);
  await page.getByRole("textbox", { name: "اسم الدخول" }).fill(E2E.driver.login);
  await page.getByRole("textbox", { name: /كلمة المرور/ }).fill(E2E.driver.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/driver/login"));
  return page;
}

/** خانة بحث واختيار (العميل، المسار، المركبة…): تكتب ثم تختار أول نتيجة مطابقة. */
export async function pick(page: Page, scope: Locator, name: string | RegExp, text: string) {
  const box = scope.getByRole("combobox", { name });
  await box.click();
  await box.fill(text);
  await page.getByRole("option", { name: new RegExp(text) }).first().click();
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}

/** رقم السجل المفتوح من الرابط (?open=رقم). */
export const openId = (page: Page) => Number(new URL(page.url()).searchParams.get("open"));

/** كل القيود المرحّلة متوازنة (المدين = الدائن بعملة الأساس). */
export async function unbalancedEntries() {
  return sql`select e.number from journal_entries e join journal_lines l on l.entry_id = e.id
    where e.status = 'posted' group by e.id having round(sum(l.debit_base), 2) <> round(sum(l.credit_base), 2)`;
}
