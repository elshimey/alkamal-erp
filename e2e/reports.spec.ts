// مركز التقارير (الخطوة 4ب): كل تقرير في المركز يفتح بلا خطأ، ويطبع بترقيم الصفحات والاتجاه المناسب.
import { expect, test } from "@playwright/test";
import { REPORT_GROUPS } from "../src/data/reports";
import { officeLogin } from "./helpers";

test("مركز التقارير: كل تقرير يفتح بلا خطأ وجاهز للطباعة", async ({ page }) => {
  test.setTimeout(180_000);
  await officeLogin(page);
  await page.goto("/reports");
  for (const g of REPORT_GROUPS) await expect(page.getByRole("heading", { name: g.title })).toBeVisible();

  for (const r of REPORT_GROUPS.flatMap((g) => g.reports)) {
    const res = await page.goto(r.href);
    expect(res?.status(), r.href).toBeLessThan(400);
    await expect(page.getByText("Application error"), r.href).toHaveCount(0);
    await expect(page.locator("main"), r.href).toContainText(r.title.split(" ")[0]);
  }

  // التقارير العريضة تُطبع بالعرض مع ترقيم الصفحات
  await page.goto("/reports/aging?side=supplier");
  const css = await page.evaluate(() => [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n"));
  expect(css).toContain("landscape");
  expect(css).toContain("counter(pages)");
});
