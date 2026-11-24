// ملاحظات التشغيل في النماذج: السائق يملأ مركبته، وEsc في التقويم يغلقه وحده،
// والإغلاق مع تعديلات غير محفوظة يسأل بنافذة البرنامج لا بتأكيد المتصفح.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { officeLogin, pick, sql } from "./helpers";

test("اختيار السائق في الشحنة يملأ المركبة المسندة له", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/waybills?new=1");
  const form = page.getByRole("dialog");
  await expect(form.getByRole("combobox", { name: "المركبة*" })).toHaveValue("");
  await pick(page, form, /^السائق/, E2E.driver.name);
  await expect(form.getByRole("combobox", { name: "المركبة*" })).toHaveValue(E2E.plate);
});

test("اختيار المركبة يملأ سائقها المسند في كل النماذج والشيتات", async ({ page }) => {
  await officeLogin(page);
  // النوافذ: الشحنة والمصروف والمخالفة وبلاغ العطل
  for (const url of ["/waybills?new=1", "/expenses?new=1", "/violations?new=1", "/maintenance/requests?new=1"]) {
    await page.goto(url);
    const form = page.getByRole("dialog");
    const driver = form.getByRole("combobox", { name: /^السائق/ }).first();
    await expect(driver, url).toHaveValue("");
    // خيارات القائمة المفتوحة فقط (في الصفحة قوائم فلترة فيها اللوحات نفسها)
    const box = form.getByRole("combobox", { name: /^المركبة/ }).first();
    await box.click();
    await box.fill(E2E.plate);
    await page.getByRole("listbox").getByRole("option", { name: E2E.plate }).first().click();
    await expect(driver, url).toHaveValue(E2E.driver.name);
  }
  // الشيت الجماعي للشحنات
  await page.goto("/waybills?add=1");
  const grid = page.locator("main");
  await pick(page, grid, "المركبة — صف 1", E2E.plate);
  await expect(grid.getByRole("combobox", { name: "السائق — صف 1" })).toHaveValue(E2E.driver.name);
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
  await page.locator("summary").getByText("تفاصيل المركبة", { exact: true }).click();
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

test("مركز تكلفة «المقطورات» من الشاشة، ثم أصل سطحة عليه، والفئة تبقى بعد الحفظ", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/cost-centers");
  await page.getByRole("button", { name: "+ مركز تكلفة" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("textbox", { name: "الاسم" }).fill("المقطورات E2E");
  await dlg.getByRole("button", { name: "إضافة المركز" }).click();
  await expect(dlg.getByRole("status")).toContainText("المقطورات E2E");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("cell", { name: "المقطورات E2E" })).toBeVisible();

  await page.goto("/fixed-assets");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "إضافة الأصل" }) });
  await form.locator("input[name=nameAr]").fill("سطحة E2E");
  await pick(page, form, /^الفئة/, "120102");
  await form.locator("select[name=costCenterId]").selectOption({ label: "المقطورات E2E" });
  await form.locator("input[name=cost]").fill("90000");
  await form.getByRole("button", { name: "إضافة الأصل" }).click();
  await expect(form.getByRole("status")).toContainText("أُضيف الأصل");
  await expect(form.locator("input[name=nameAr]")).toHaveValue("");
  await expect(form.locator("input[type=hidden][name=assetAccountId]")).not.toHaveValue("");
  const [a] = await sql`select c.name_ar from fixed_assets f join cost_centers c on c.id = f.cost_center_id where f.name_ar = 'سطحة E2E'`;
  expect(a.name_ar).toBe("المقطورات E2E");
});

test("شيت إدخال عدة شحنات: التاريخ يُختار من التقويم نفسه", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/waybills?add=1");
  const cell = page.getByRole("textbox", { name: "التاريخ — صف 2" });
  await expect(cell).toHaveValue("");
  await cell.locator("xpath=..").getByRole("button", { name: "اختر من التقويم" }).click();
  const calendar = page.getByRole("dialog", { name: "التقويم" });
  await expect(calendar).toBeVisible();
  await calendar.getByRole("button", { name: "اليوم" }).click();
  await expect(calendar).toBeHidden();
  // «اليوم» حسب ساعة المتصفح
  const now = await page.evaluate(() => {
    const n = new Date();
    return `${String(n.getDate()).padStart(2, "0")}/${String(n.getMonth() + 1).padStart(2, "0")}/${n.getFullYear()}`;
  });
  await expect(cell).toHaveValue(now);
  // Esc يغلق التقويم وحده والشيت يبقى
  await cell.locator("xpath=..").getByRole("button", { name: "اختر من التقويم" }).click();
  await page.keyboard.press("Escape");
  await expect(calendar).toBeHidden();
  await expect(cell).toBeVisible();
});

test("«عرض كل الشجرة» داخل قائمة «تم الدفع من خلال» نفسها (سند القبض ونموذج المصروف)", async ({ page }) => {
  await officeLogin(page);
  const liability = page.getByRole("listbox").getByRole("option").filter({ hasText: /\b2\d{3,}\b/ });
  for (const [url, scope, name] of [
    ["/receipts/new", page.locator("main"), /تم الدفع من خلال/],
    ["/expenses?new=1", page.getByRole("dialog"), /^دُفع من/],
  ] as const) {
    await page.goto(url);
    const box = scope.getByRole("combobox", { name }).first();
    await box.click();
    await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible();
    await expect(liability).toHaveCount(0);
    // البند داخل القائمة المفتوحة: النقر عليه لا يغلقها، ويظهر باقي الشجرة (الالتزامات 2xxx)
    await page.getByRole("button", { name: /عرض كل الشجرة/ }).click();
    await expect(liability.first()).toBeVisible();
    await liability.first().click();
    await expect(box).toHaveValue(/2\d{3,}/);
  }
});
