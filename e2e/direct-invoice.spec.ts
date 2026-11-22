// الفاتورة المباشرة بنفس نافذة الشحنة (قرار أحمد 2026-11-22): المسار والتنفيذ والسعر، «حفظ وإصدار وإرسال للسائق»،
// والسائق يجدها «في الطريق» بزر واحد «تم التسليم» وصورة اختيارية.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { driverPhone, expectToast, officeLogin, pick, sql, unbalancedEntries } from "./helpers";

test("فاتورة مباشرة بنقلها: تصدر وتُرسل للسائق على مرحلة التسليم، فيسلّم دون صورة", async ({ page, browser }) => {
  const shipper = `مرسل مباشر ${Date.now()}`;
  await officeLogin(page);
  await page.goto("/invoices?new=1");
  const form = page.getByRole("dialog");
  await pick(page, form, "العميل*", E2E.customer);
  await pick(page, form, /^المسار/, "مدينة الاختبار أ");
  await form.getByRole("combobox", { name: "المرسل*" }).fill(shipper);
  await page.keyboard.press("Tab");
  await form.getByRole("combobox", { name: "المستلم*" }).fill("مستلم مباشر");
  await page.keyboard.press("Tab");
  // نفس أقسام الشحنة
  await expect(form.getByText("التنفيذ", { exact: true })).toBeVisible();
  await pick(page, form, "المركبة*", "1234");
  await form.getByRole("textbox", { name: /^السعر الأساسي/ }).fill("3000");
  // المعاينة فيها سطر النقل
  await expect(form.getByLabel("معاينة الفاتورة").getByText(/خدمة نقل/).first()).toBeVisible();
  await form.getByText("إرسال للسائق", { exact: true }).click();
  await form.getByRole("checkbox", { name: "أرسلها للسائق على مرحلة التسليم" }).check();
  await form.getByRole("button", { name: "حفظ وإصدار وإرسال للسائق" }).click();
  await expectToast(page, /صدرت برقم INV-/);

  const [w] = await sql`select w.id, w.status, w.deliver_only, w.source_invoice_id from waybills w where w.shipper = ${shipper}`;
  expect(w).toMatchObject({ status: "approved", deliver_only: true });
  const [inv] = await sql`select status, subtotal::float from sales_invoices where id = ${w.source_invoice_id}`;
  expect(inv).toMatchObject({ status: "issued", subtotal: 3000 });
  const lines = await sql`select trip, amount::float from sales_invoice_lines where invoice_id = ${w.source_invoice_id}`;
  expect(lines.map((l) => [l.trip, l.amount])).toEqual([[true, 3000]]);

  // السائق: لا «استلمت» ولا «تم التحميل»، فقط «تم التسليم» والصورة اختيارية
  const phone = await driverPhone(browser);
  await phone.goto(`/driver/trips/${w.id}`);
  await expect(phone.getByRole("button", { name: "تم التسليم" })).toBeVisible();
  await expect(phone.getByRole("button", { name: "استلمت الرحلة" })).toHaveCount(0);
  await expect(phone.getByRole("button", { name: "تم التحميل" })).toHaveCount(0);
  await phone.getByRole("button", { name: "تم التسليم" }).click();
  await expect.poll(async () => (await sql`select count(*)::int n from trip_stages where waybill_id = ${w.id} and stage = 'delivery'`)[0].n).toBe(1);
  await phone.context().close();
  expect(await unbalancedEntries()).toEqual([]);
});

test("إدخال عدة فواتير: كل صف فاتورة مباشرة بنقلها", async ({ page }) => {
  const shipper = `مرسل شيت ${Date.now()}`;
  await officeLogin(page);
  await page.goto("/invoices?add=1");
  await expect(page.getByText("إدخال عدة فواتير").first()).toBeVisible();
  const grid = page.locator("main");
  await pick(page, grid, "العميل — صف 1", E2E.customer);
  await pick(page, grid, "المسار — صف 1", "مدينة الاختبار أ");
  await grid.getByRole("combobox", { name: "المرسل — صف 1" }).fill(shipper);
  await grid.getByRole("combobox", { name: "المستلم — صف 1" }).fill("مستلم شيت");
  await pick(page, grid, "المركبة — صف 1", "1234");
  await grid.getByRole("textbox", { name: "السعر الأساسي — صف 1" }).fill("1800");
  await page.getByRole("button", { name: /^حفظ/ }).first().click();
  await expect.poll(async () => (await sql`select count(*)::int n from waybills where shipper = ${shipper} and source_invoice_id is not null`)[0].n).toBe(1);
  const [l] = await sql`select l.trip, l.amount::float from sales_invoice_lines l join waybills w on w.source_invoice_id = l.invoice_id where w.shipper = ${shipper}`;
  expect(l).toMatchObject({ trip: true, amount: 1800 });
});
