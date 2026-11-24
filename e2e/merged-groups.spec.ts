// الشحنات المدمجة صف واحد بسهم (قرار أحمد 2026-11-24)، والتحديد يزول بعد نجاح الإجراء الجماعي،
// واختيار عدة مركبات في تقرير الربحية. البيانات: شحنتان معتمدتان لـ«عميل الشحنات المدمجة» من seed.ts.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { officeLogin } from "./helpers";

test.use({ viewport: { width: 1366, height: 860 } });

test("دمج شحنتين: التحديد يزول، وتظهران صفاً واحداً يُفتح بسهم في الشحنات والفواتير والجوال", async ({ page }) => {
  test.setTimeout(120_000);
  await officeLogin(page);
  const q = encodeURIComponent(E2E.mergeCustomer);

  await page.goto(`/waybills?status=pending_invoice&q=${q}`);
  const boxes = page.locator("main tbody input[type=checkbox][name=ids]");
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  const bar = page.getByRole("toolbar", { name: "عمليات المحدد" });
  await bar.getByRole("button", { name: "دمج المحدد" }).click();
  await expect(page.getByRole("status").filter({ hasText: "دُمجت" }).first()).toBeVisible();
  // التحديد زال والشريط اختفى
  await expect(bar).toBeHidden();
  await expect(page.locator("main tbody input[type=checkbox]:checked")).toHaveCount(0);

  // صف واحد للفاتورة المدمجة، وشحنتاه مطويتان حتى يُضغط السهم
  await page.goto(`/waybills?q=${q}`);
  const group = page.locator("main tbody tr[data-merged-group]");
  await expect(group).toHaveCount(1);
  await expect(group).toContainText("2 شحنات");
  const kids = page.locator("main tbody tr[data-kid-of]");
  await expect(kids).toHaveCount(2);
  await expect(kids.first()).toBeHidden();
  await group.getByRole("button", { name: /عرض 2 شحنات/ }).click();
  await expect(kids.first()).toBeVisible();
  await expect(kids.nth(1)).toBeVisible();
  // مربع المجموعة يحدد شحنتيها
  await group.getByRole("checkbox", { name: "تحديد كل شحنات الفاتورة" }).check();
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("2");
  await group.getByRole("checkbox", { name: "تحديد كل شحنات الفاتورة" }).uncheck();
  await expect(bar).toBeHidden();
  await group.getByRole("button", { name: /إخفاء 2 شحنات/ }).click();
  await expect(kids.first()).toBeHidden();

  // الفواتير: سهم بجانب الفاتورة يفتح شحنتيها
  await page.goto(`/invoices?q=${q}`);
  const toggle = page.locator("main tbody").getByRole("button", { name: /عرض 2 شحنات/ });
  await expect(toggle).toBeVisible();
  const invKids = page.locator("main tbody tr[data-kid-of]");
  await expect(invKids.first()).toBeHidden();
  await toggle.click();
  await expect(invKids).toHaveCount(2);
  await expect(invKids.first()).toBeVisible();
  await expect(invKids.first()).toContainText("WB-");

  // الجوال: بطاقة واحدة متراكبة وزر «عرض الشحنات»
  await page.setViewportSize({ width: 400, height: 850 });
  await page.goto(`/waybills?q=${q}`);
  const card = page.locator("[data-doc-group]");
  await expect(card).toHaveCount(1);
  await card.getByText("عرض الشحنات (2)").click();
  await expect(card.getByRole("link", { name: /WB-/ })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("تقرير الربحية: اختيار مركبات محددة بمربعات التحديد", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/reports/fleet-profit");
  await page.locator("summary").filter({ hasText: "كل المركبات" }).click();
  await page.getByRole("checkbox", { name: E2E.mergePlate }).check();
  await page.getByRole("checkbox", { name: E2E.plate }).check();
  await page.getByRole("button", { name: "عرض" }).click();
  await expect(page).toHaveURL(/[?&]id=\d+(%2C|,)\d+/);
  await expect(page.locator("summary").filter({ hasText: E2E.mergePlate })).toBeVisible();
  await expect(page.locator("main table tbody")).toContainText(E2E.mergePlate);
});
