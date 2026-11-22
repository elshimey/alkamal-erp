// فاتورة المورد بنافذة واحدة مثل فاتورة المبيعات (قرار أحمد 2026-11-22): التاريخ من التقويم، والبنود بطاقات، و«حفظ وترحيل».
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { officeLogin, pick, sql, unbalancedEntries } from "./helpers";

test("فاتورة مورد من النافذة: بند على المركبة، حفظ وترحيل بقيد متوازن، والجوال دون تداخل", async ({ page, browser }) => {
  const [p] = await sql`insert into parties (name_ar) values ('مورد قطع الاختبار') returning id`;
  await sql`insert into party_roles (party_id, role) values (${p.id}, 'supplier')`;

  await officeLogin(page);
  await page.goto("/purchases");
  await page.getByRole("link", { name: "+ فاتورة مورد" }).click();
  const form = page.getByRole("dialog");
  await pick(page, form, /^المورد/, "مورد قطع الاختبار");
  await form.locator("input[name=supplierInvoiceNo]").fill("SUP-E2E-1");
  // الاستحقاق يتبع التاريخ بعد 30 يوماً
  const date = form.getByRole("textbox", { name: /^تاريخ الفاتورة/ });
  await date.fill("01112026");
  await expect(form.getByRole("textbox", { name: /^تاريخ الاستحقاق/ })).toHaveValue("01/12/2026");
  const card = form.locator("[data-line-card]").first();
  await pick(page, card, /^الحساب/, "5107");
  await pick(page, card, /^المركبة/, E2E.plate);
  await card.getByRole("textbox", { name: /^المبلغ قبل الضريبة/ }).fill("1000");
  await expect(form.getByText("1,150.00")).toBeVisible();
  await form.getByRole("button", { name: "حفظ وترحيل" }).click();
  await expect.poll(async () => (await sql`select count(*)::int as n from purchase_invoices where supplier_invoice_no = 'SUP-E2E-1'`)[0].n).toBe(1);
  const [inv] = await sql`select status, total::float as total, invoice_date::text as d, due_date::text as due from purchase_invoices where supplier_invoice_no = 'SUP-E2E-1'`;
  expect(inv).toMatchObject({ status: "posted", total: 1150, d: "2026-11-01", due: "2026-12-01" });
  expect(await unbalancedEntries()).toEqual([]);

  // الجوال: الخانات بطاقات بعرض الشاشة، ولا سحب جانبي للصفحة
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await page.context().storageState() });
  const phone = await ctx.newPage();
  await phone.goto("/purchases?new=1");
  const dlg = phone.getByRole("dialog");
  await expect(dlg.locator("[data-line-card]").first()).toBeVisible();
  const box = await dlg.getByRole("textbox", { name: /^المبلغ قبل الضريبة/ }).first().boundingBox();
  expect(box!.width).toBeGreaterThan(120);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});
