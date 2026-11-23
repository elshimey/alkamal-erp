// شكل القوائم على الكمبيوتر (الخطوة 3 من خطة «توحيد الفاتورة مع الشحنة»، اعتمدها أحمد 2026-11-23):
// رأس جدول فاتح، وأزرار حالات بعددها، والصف بزر «الخطوة التالية» وخط لون الحالة،
// والنقر على الصف يفتح معاينة جانبية تُغلق بـ× وEsc والنقر خارجها، وتحديد صف يُظهر شريط العمليات العائم.
// اسم الملف يبدأ بـ zz ليعمل آخراً: يعتمد على الشحنات والفواتير والسندات التي أنشأتها الاختبارات قبله.
import { expect, test } from "@playwright/test";
import { officeLogin } from "./helpers";

test.use({ viewport: { width: 1366, height: 860 } });

test("الكمبيوتر: الشحنات والفواتير والسندات صفوف كالبطاقة ومعاينة جانبية تُغلق بكل الطرق", async ({ page }) => {
  test.setTimeout(120_000);
  await officeLogin(page);
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  for (const [path, nav, label, head] of [
    ["/waybills", "حالة الشحنات", "معاينة الشحنة", "الخطوة التالية"],
    ["/invoices", "حالة الفواتير", "معاينة الفاتورة", "الخطوة التالية"],
    ["/receipts", "نوع السند", "معاينة السند", "الخطوة التالية"],
  ] as const) {
    await page.goto(path);
    // رأس الجدول فاتح لا أسود
    const th = page.locator("main thead").first();
    await expect(th.getByText(head)).toBeVisible();
    const bg = await th.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, path).not.toBe("rgb(27, 33, 38)");
    // أزرار الحالات بعددها، والتاريخ يوم/شهر/سنة
    await expect(page.getByRole("navigation", { name: nav })).toBeVisible();
    await expect(page.locator("main tbody tr").first()).toContainText(/\d{2}\/\d{2}\/\d{4}/);
    expect(await noSideScroll(), path).toBe(true);

    for (const close of ["esc", "x", "backdrop"] as const) {
      await page.locator("main tbody tr").first().locator("td").nth(path === "/receipts" ? 1 : 2).click();
      const drawer = page.getByRole("complementary", { name: new RegExp(label) });
      await expect(drawer, `${path} ${close}`).toBeVisible();
      await expect(drawer.getByRole("link", { name: /فتح كاملة/ })).toBeVisible();
      // أزرار المعاينة داخل الشاشة (لا تختفي أسفلها)
      const box = await drawer.getByRole("link", { name: /فتح كاملة/ }).boundingBox();
      expect(box && box.y + box.height <= 860, `${path} أزرار المعاينة ظاهرة`).toBe(true);
      if (close === "esc") await page.keyboard.press("Escape");
      else if (close === "x") await drawer.getByRole("link", { name: "إغلاق المعاينة" }).click();
      else await page.mouse.click(1100, 600);
      await expect(drawer, `${path} ${close}`).toBeHidden();
      await expect(page).not.toHaveURL(/[?&]open=/);
    }
  }

  // الشحنة المسودة غير المرسلة: «أرسلها للسائق» بالأصفر في صفها
  await page.goto("/waybills?status=draft");
  await expect(page.locator("main tbody").getByRole("button", { name: "أرسلها للسائق" }).first()).toBeVisible();

  // تحديد فاتورة يُظهر شريط العمليات العائم داخل الشاشة، وإلغاء التحديد يخفيه
  await page.goto("/invoices");
  const box = page.locator("main tbody input[type=checkbox]").first();
  await box.check();
  const bar = page.getByRole("toolbar", { name: "عمليات المحدد" });
  await expect(bar).toBeVisible();
  const b = await bar.boundingBox();
  expect(b && b.y + b.height <= 860, "الشريط داخل الشاشة").toBe(true);
  await expect(bar.getByRole("button", { name: "اعتماد وإصدار" })).toBeVisible();
  await box.uncheck();
  await expect(bar).toBeHidden();
});
