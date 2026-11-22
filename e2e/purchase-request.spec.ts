// طلب الشراء على الجوال (قرار أحمد 2026-11-22): نافذة بالتقويم والأصناف بطاقات، وقائمة الطلبات بطاقات بأزرارها.
import { expect, test } from "@playwright/test";
import { officeLogin, sql } from "./helpers";

test("طلب شراء من الجوال: النافذة دون تداخل، ثم البطاقة واعتمادها منها", async ({ page, browser }) => {
  await officeLogin(page);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await page.context().storageState() });
  const phone = await ctx.newPage();
  await phone.goto("/purchase-requests");
  await phone.getByRole("link", { name: "+ طلب شراء" }).click();
  const dlg = phone.getByRole("dialog");
  await dlg.getByRole("textbox", { name: /^مطلوب قبل/ }).fill("30112026");
  await expect(dlg.getByRole("textbox", { name: /^مطلوب قبل/ })).toHaveValue("30/11/2026");
  const card = dlg.locator("[data-line-card]").first();
  const desc = card.getByRole("textbox", { name: /^الوصف/ });
  expect((await desc.boundingBox())!.width).toBeGreaterThan(200);
  await desc.fill("إطار اختبار الجوال");
  await card.getByRole("textbox", { name: /^الكمية/ }).fill("4");
  await card.getByRole("textbox", { name: /^السعر التقديري/ }).fill("850");
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dlg.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(dlg).toBeHidden();

  const [pr] = await sql`select r.id, r.status, r.needed_by::text as needed from purchase_requests r join purchase_request_lines l on l.request_id = r.id where l.description = 'إطار اختبار الجوال'`;
  expect(pr).toMatchObject({ status: "draft", needed: "2026-11-30" });

  // البطاقة: الصنف والمبلغ التقديري، و«اعتماد» تحتها مباشرة
  const doc = phone.locator("[data-doc-card]").filter({ hasText: "إطار اختبار الجوال" });
  await expect(doc).toContainText("3,400.00");
  await doc.getByRole("button", { name: "اعتماد" }).click();
  await expect(doc.getByRole("link", { name: "إصدار أمر شراء" })).toBeVisible();
  expect((await sql`select status from purchase_requests where id = ${pr.id}`)[0].status).toBe("approved");
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});
