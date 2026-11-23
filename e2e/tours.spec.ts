// دليل الاستخدام: كل خطوة في كل جولة تضيء بندها فعلاً في الشاشة الحقيقية، والجولة تتصرف كما يستخدمها
// المبتدئ: تنتقل وحدها حين يملأ الخانة، و«أعرف هذا» يقفز للقسم التالي، و× يوقفها وتُستكمل لاحقاً.
import { expect, test, type Page } from "@playwright/test";
import { TOURS, type TourStep } from "@/data/tours";
import { E2E } from "./data";
import { officeLogin, pick, sql } from "./helpers";

const KEY = "alkamal-tour";
const ring = (page: Page) => page.locator("[data-tour-ui] .ring-4");
const card = (page: Page) => page.locator('[data-tour-ui] [role="dialog"], [data-tour-ui][role="dialog"]').first();

async function setTour(page: Page, id: string, step: number) {
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify({ id, step, since: new Date().toISOString() })]);
}

/** الخطوات التي يجب أن يظهر بندها دائماً (لا تعتمد على بيانات أو على ضغطة قبلها) */
const mustShow = (s: TourStep) => !!s.target && !s.missing && !s.path.includes("[");

test("كل بند في كل جولة موجود في شاشته", async ({ page }) => {
  test.setTimeout(600_000);
  await officeLogin(page);
  const misses: string[] = [];
  let slowest = 0;
  for (const tour of TOURS) {
    for (const [i, s] of tour.steps.entries()) {
      if (!mustShow(s)) continue;
      await setTour(page, tour.id, i);
      const t0 = Date.now();
      await page.goto(s.href ?? s.path);
      const ok = await ring(page)
        .waitFor({ state: "visible", timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (ok) slowest = Math.max(slowest, Date.now() - t0);
      else misses.push(`${tour.id} #${i + 1} «${s.title}» في ${s.href ?? s.path}`);
    }
  }
  console.log(`أبطأ ظهور لبند بعد فتح الصفحة: ${slowest} ملي ثانية`);
  expect(misses, misses.join("\n")).toEqual([]);
});

test("جولة المركبة: تنتقل وحدها مع الكتابة، و«أعرف هذا» يقفز، و× يوقفها وتُستكمل", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/help");
  await page.locator("section", { hasText: "إضافة مركبة" }).getByRole("button", { name: "ابدأ الجولة" }).first().click();
  await page.waitForURL(/\/vehicles/);
  await expect(card(page)).toContainText("إضافة مركبة");
  await expect(ring(page)).toBeVisible();

  // الضغط على البند المضاء يفتح النافذة وتنتقل الجولة لأول خانة فوراً
  await page.getByRole("link", { name: "+ إضافة مركبة" }).click();
  const panel = page.locator('[role="dialog"][aria-label="إضافة مركبة"]:not([data-tour-ui] *)');
  await expect(panel).toBeVisible();
  await expect(card(page)).toContainText("اللوحة: الأحرف");

  // الكتابة في الخانة تنقل الجولة وحدها
  await panel.locator("input[name=plateLetters]").fill("ا ب د");
  await panel.locator("input[name=plateNumbers]").focus();
  await expect(card(page)).toContainText("اللوحة: الأرقام", { timeout: 3000 });

  // «أعرف هذا» يقفز لأول خطوة بعد «البيانات الأساسية»
  await card(page).getByRole("button", { name: "أعرف هذا" }).click();
  await expect(card(page)).toContainText("تفاصيل المركبة");

  // «السابق» فوري
  const t0 = Date.now();
  await card(page).getByRole("button", { name: "السابق" }).click();
  await expect(card(page)).toContainText("حساب الأصل");
  expect(Date.now() - t0).toBeLessThan(1500);

  // Esc والنافذة مفتوحة لا يوقف الجولة (Esc للنافذة نفسها): فيها كتابة فتسأل بنافذة البرنامج، وEsc ثانٍ يبقيها
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(card(page)).toBeVisible();

  // × يوقف الجولة، وصفحة الدليل تعرض «استكمل»
  await page.locator("[data-tour-ui]").getByRole("button", { name: "إيقاف الجولة" }).first().click();
  await expect(page.locator("[data-tour-ui]")).toHaveCount(0);
  await page.goto("/help");
  await expect(page.getByRole("button", { name: /استكمل من الخطوة/ })).toBeVisible();
});

test("زر «كيف أعمل هذا؟» يبدأ جولة الشاشة من مكانها", async ({ page }) => {
  await officeLogin(page);
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.goto("/assignments");
  await page.getByRole("button", { name: /كيف أعمل هذا/ }).click();
  await expect(card(page)).toContainText("استلام مركبة");
  await expect(ring(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-tour-ui]")).toHaveCount(0);
});

test("جولة الشحنة: تضيء زر «الخطوة التالية» في صف الشحنة، والضغط عليه ينقل الجولة", async ({ page }) => {
  await officeLogin(page);
  const [w] = await sql`select id from waybills where status = 'draft' and execution = 'fleet' and sent_to_driver_at is null order by id desc limit 1`;
  test.skip(!w, "لا توجد شحنة مسودة لم تُرسل");
  const i = TOURS.find((t) => t.id === "shipment")!.steps.findIndex((s) => s.title === "أرسلها للسائق");
  await setTour(page, "shipment", i);
  await page.goto("/waybills");
  await expect(ring(page)).toBeVisible();
  await page.locator("main").getByRole("button", { name: "أرسلها للسائق" }).first().click();
  await expect(card(page)).toContainText("السائق ينفذ");
  // نافذة التأكيد تُغلق دون إرسال
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeVisible();
});

test("الجولات الجديدة: الأقساط ومركز التكلفة والتقارير تضيء بنودها", async ({ page }) => {
  await officeLogin(page);
  for (const [id, title] of [
    ["installments", "اسم الجدول"],
    ["cost-center", "مركز جديد"],
    ["reports", "الأهم"],
    ["fleet-profit", "حسب المركبة أو السائق"],
    ["bulk-invoices", "صف لكل فاتورة"],
  ] as const) {
    const tour = TOURS.find((t) => t.id === id)!;
    const i = tour.steps.findIndex((s) => s.title === title);
    expect(i, `${id}: ${title}`).toBeGreaterThanOrEqual(0);
    await setTour(page, id, i);
    await page.goto(tour.steps[i].href ?? tour.steps[i].path);
    await expect(ring(page), `${id}: ${title}`).toBeVisible();
    await expect(card(page)).toContainText(title);
  }
});

test("الجولات الجديدة: الضغط على البند المضاء يفتح النافذة أو القائمة وتكمل الجولة داخلها", async ({ page }) => {
  await officeLogin(page);
  const start = async (id: string, title: string, lit = true) => {
    const tour = TOURS.find((t) => t.id === id)!;
    const i = tour.steps.findIndex((s) => s.title === title);
    await setTour(page, id, i);
    await page.goto(tour.steps[i].href ?? tour.steps[i].path);
    await expect(card(page)).toContainText(title);
    if (lit) await expect(ring(page)).toBeVisible();
  };

  // مركز التكلفة: الزر يفتح النافذة والجولة تضيء أول خانة فيها
  await start("cost-center", "مركز جديد");
  await page.locator("main").getByRole("button", { name: "+ مركز تكلفة" }).click();
  await expect(card(page)).toContainText("مثل: المقطورات");
  await expect(ring(page)).toBeVisible();

  // عدة فواتير: «إضافة» يفتح القائمة، ثم بندها، ثم الشيت
  await start("bulk-invoices", "قائمة الإضافة");
  await page.locator('main button[aria-haspopup="menu"]').first().click();
  await expect(card(page)).toContainText("اختر «إدخال عدة فواتير»");
  await expect(ring(page)).toBeVisible();
  await page.getByRole("menuitem", { name: "إدخال عدة فواتير" }).click();
  await page.waitForURL(/add=1/);
  await expect(card(page)).toContainText("صف لكل فاتورة");
  await expect(ring(page)).toBeVisible();

  // الفاتورة المباشرة: اختيار المسار يُظهر قسم «التنفيذ» فتضيئه الجولة
  await start("direct-invoice", "التنفيذ", false);
  const form = page.locator('[role="dialog"][aria-modal="true"]:not([data-tour-ui] *)').first();
  await pick(page, form, "العميل*", E2E.customer);
  await pick(page, form, /^المسار/, "مدينة الاختبار أ");
  await expect(ring(page)).toBeVisible();
});
