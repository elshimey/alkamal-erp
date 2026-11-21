// ملاحظات التشغيل في النماذج: السائق يملأ مركبته، وEsc في التقويم يغلقه وحده،
// والإغلاق مع تعديلات غير محفوظة يسأل بنافذة البرنامج لا بتأكيد المتصفح.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { officeLogin, pick } from "./helpers";

test("اختيار السائق في الشحنة يملأ المركبة المسندة له", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/waybills?new=1");
  const form = page.getByRole("dialog");
  await expect(form.getByRole("combobox", { name: "المركبة*" })).toHaveValue("");
  await pick(page, form, /^السائق/, E2E.driver.name);
  await expect(form.getByRole("combobox", { name: "المركبة*" })).toHaveValue(E2E.plate);
});

test("Esc داخل التقويم يغلقه وحده، والإغلاق مع تعديلات يسأل بنافذة البرنامج", async ({ page }) => {
  // تأكيد المتصفح يوقف الصفحة: يجب ألا يظهر أبداً
  page.on("dialog", (d) => {
    throw new Error(`ظهر تأكيد المتصفح: ${d.message()}`);
  });
  await officeLogin(page);
  await page.goto("/vehicles?new=1");
  const title = page.getByRole("heading", { name: "إضافة مركبة" });
  await expect(title).toBeVisible();
  await page.getByText("تفاصيل المركبة", { exact: true }).click();
  await page.getByRole("button", { name: "اختر من التقويم" }).first().click();
  const calendar = page.getByRole("dialog", { name: "التقويم" });
  await expect(calendar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar).toBeHidden();
  await expect(title).toBeVisible();

  // تعديل ثم إغلاق: نافذة البرنامج، و«متابعة التعديل» تبقي النافذة
  await page.locator("input[name=plateNumbers]").fill("4321");
  await page.getByRole("button", { name: "إغلاق" }).first().click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "متابعة التعديل" }).click();
  await expect(ask).toBeHidden();
  await expect(title).toBeVisible();
  // Esc يغلق نافذة السؤال وحدها
  await page.getByRole("button", { name: "إغلاق" }).first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(title).toBeVisible();
  // «تجاهل التعديلات» يغلق النافذة
  await page.getByRole("button", { name: "إغلاق" }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "تجاهل التعديلات" }).click();
  await expect(title).toBeHidden();
});

test("العملاء والموردون: الزر الرئيسي يضيف جهة واحدة", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/parties");
  await page.getByRole("link", { name: "+ إضافة جهة" }).click();
  await expect(page.getByRole("heading", { name: "إضافة جهة" })).toBeVisible();
  await page.locator("input[name=nameAr]").fill("مخلص الاختبار");
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(page.getByRole("heading", { name: "إضافة جهة" })).toBeHidden();
  await expect(page.getByRole("link", { name: /مخلص الاختبار/ }).first()).toBeVisible();
});
