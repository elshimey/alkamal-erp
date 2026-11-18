// دليل الاستخدام: كل خطوة في كل جولة تضيء بندها فعلاً في الشاشة الحقيقية، والجولة تتصرف كما يستخدمها
// المبتدئ: تنتقل وحدها حين يملأ الخانة، و«أعرف هذا» يقفز للقسم التالي، و× يوقفها وتُستكمل لاحقاً.
import { expect, test, type Page } from "@playwright/test";
import { TOURS, type TourStep } from "@/data/tours";
import { officeLogin } from "./helpers";

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
  const panel = page.locator('[role="dialog"][aria-label="إضافة مركبة"]');
  await expect(panel).toBeVisible();
  await expect(card(page)).toContainText("اللوحة: الأحرف");

  // الكتابة في الخانة تنقل الجولة وحدها
  await panel.getByRole("textbox", { name: /الأحرف/ }).fill("ا ب د");
  await panel.getByRole("textbox", { name: /الأرقام/ }).focus();
  await expect(card(page)).toContainText("اللوحة: الأرقام", { timeout: 3000 });

  // «أعرف هذا» يقفز لأول خطوة بعد «البيانات الأساسية»
  await card(page).getByRole("button", { name: "أعرف هذا" }).click();
  await expect(card(page)).toContainText("تفاصيل المركبة");

  // «السابق» فوري
  const t0 = Date.now();
  await card(page).getByRole("button", { name: "السابق" }).click();
  await expect(card(page)).toContainText("حساب الأصل");
  expect(Date.now() - t0).toBeLessThan(1500);

  // Esc مع النافذة المفتوحة يغلقها هي، والجولة تبقى
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-tour-ui]").first()).toBeVisible();

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
