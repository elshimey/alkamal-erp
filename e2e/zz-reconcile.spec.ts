// التسوية البنكية: حركة تُرحَّل من «حركة في الكشف غير مسجلة» تظهر مؤشراً عليها فوراً ويصبح الفرق صفراً
// (كانت تُؤشَّر في القاعدة لكن الجدول يبقى على تأشيره القديم فلا يُفعَّل «إكمال التسوية»؛ ظهر أثناء تصوير فيديو الشرح).
// الاسم يبدأ بـ zz ليعمل بعد اختبار الجولات: رصيده الافتتاحي قيد افتتاحي يغيّر خطوة «الأرصدة الافتتاحية» في معالج الإعداد.
import { expect, test } from "@playwright/test";
import { officeLogin, sql, unbalancedEntries } from "./helpers";

test("رسوم الكشف غير المسجلة تُرحَّل وتُؤشَّر ويُكمل التسوية", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/bank-accounts");
  const add = page.locator("main form").filter({ has: page.locator("select[name=kind]") }).last();
  // صندوق لا حساب بنكي: اختبارات سابقة تقيد على 1102 مباشرة فلا يقبل حساباً فرعياً تحته
  await add.locator("select[name=kind]").selectOption("cash");
  await add.locator("input[name=nameAr]").fill("بنك التسوية E2E");
  await add.locator("input[name=openingBalance]").fill("1000");
  await add.locator("button[type=submit]").last().click();
  await expect.poll(async () => (await sql`select count(*)::int as n from accounts where name_ar = 'بنك التسوية E2E'`)[0].n).toBe(1);

  await page.goto("/bank-accounts/reconcile?add=1");
  const acc = page.getByPlaceholder("اختر البنك أو الصندوق");
  await acc.click();
  await acc.fill("بنك التسوية");
  await page.getByRole("option").filter({ hasText: "بنك التسوية E2E" }).first().click();
  await page.locator("input[name=statementBalance]").fill("985");
  await page.getByRole("button", { name: "ابدأ التسوية" }).click();
  await page.waitForURL(/\/bank-accounts\/reconcile\/\d+$/);

  await page.locator("main tbody tr").filter({ hasText: "رصيد افتتاحي" }).locator("input[type=checkbox]").check();
  await page.getByRole("button", { name: "حفظ التأشير" }).click();
  await expect(page.getByText("حُفظ التأشير")).toBeVisible();

  await page.locator("input[name=amount]").fill("15");
  await page.getByRole("button", { name: "ترحيل وتأشير" }).click();
  const fee = page.locator("main tbody tr").filter({ hasText: "15.00" });
  await expect(fee.locator("input[type=checkbox]")).toBeChecked();
  await expect(page.getByRole("button", { name: "إكمال التسوية" })).toBeEnabled();
  expect(await unbalancedEntries()).toEqual([]);
});
