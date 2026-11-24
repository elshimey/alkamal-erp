// نوافذ الإضافة الموحدة (قرار أحمد 2026-11-24، «الفهرس الجانبي»): فهرس بالأقسام وعلامات ✓، وEnter للخانة التالية،
// وقسم «المصاريف» في الشحنة: مصروف «على الشركة» «لم تُدفع بعد» يُحفظ تكلفةً على الرحلة لا على العميل.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { expectToast, officeLogin, openId, pick, sql } from "./helpers";

test.use({ viewport: { width: 1600, height: 1000 } });

test("نافذة الشحنة: الفهرس الجانبي و✓ وEnter، ومصروف على الشركة لم يُدفع بعد", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/waybills?new=1");
  const form = page.getByRole("dialog");
  const rail = form.getByRole("navigation", { name: "فهرس الأقسام" });
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("button", { name: /بيانات الشحنة/ })).toBeVisible();

  await pick(page, form, "العميل*", E2E.customer);
  // ✓ بجانب الخانة المعبأة
  await expect(form.locator('[data-pf][data-ok="1"]').filter({ hasText: "العميل" })).toBeVisible();
  await pick(page, form, /^المسار/, "مدينة الاختبار أ");
  await form.getByRole("combobox", { name: "المرسل*" }).fill("مرسل الفهرس");
  await page.keyboard.press("Tab");
  await form.getByRole("combobox", { name: "المستلم*" }).fill("مستلم الفهرس");
  await page.keyboard.press("Tab");
  await pick(page, form, "المركبة*", "1234");
  await expect(form.getByText(/^تعديلات لم تُحفظ$/)).toBeVisible();

  // Enter ينقل للخانة التالية بدل الحفظ
  await rail.getByRole("button", { name: /الحمولة والمستندات/ }).click();
  const weight = form.getByRole("textbox", { name: /^الوزن/ });
  await weight.fill("12");
  await weight.press("Enter");
  await expect(weight).not.toBeFocused();
  await expect(page).toHaveURL(/new=1/);

  // مصروف على الشركة لم يُدفع بعد
  await rail.getByRole("button", { name: /المصاريف/ }).click();
  await form.getByRole("button", { name: "+ إضافة مصروف" }).click();
  const type = form.getByPlaceholder("النوع: تخليص، رسوم ميناء، مبيت…");
  await type.click();
  await type.fill("رسوم جمركية");
  await page.getByRole("option", { name: /رسوم جمركية/ }).first().click();
  await form.getByRole("textbox", { name: "المبلغ" }).fill("75");
  await form.getByRole("radiogroup", { name: "على من" }).getByRole("radio", { name: "الشركة" }).click();
  await form.getByRole("radiogroup", { name: "الدفع" }).getByRole("radio", { name: "لم تُدفع بعد" }).click();
  await expect(form.getByText(/تكلفة على الرحلة، تُعتمد وتُسدد/)).toBeVisible();

  await form.getByRole("button", { name: "حفظ", exact: true }).click();
  await expectToast(page, /أُنشئت الشحنة WB-/);
  await page.waitForURL(/[?&]open=\d+/);
  const [e] = await sql`select bill_to, payer, amount::float, journal_entry_id from waybill_expenses where waybill_id = ${openId(page)}`;
  expect(e).toMatchObject({ bill_to: "company", payer: "unpaid", amount: 75, journal_entry_id: null });
});
