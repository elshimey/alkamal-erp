// خريطة الشاشات: يفتح كل شاشة في البرنامج المبني ويكتب ما فيها بالترتيب (الأزرار، الأقسام، الخانات
// المطلوبة والاختيارية)، ثم يفتح نافذة «+ إضافة» ويكتب أقسامها وخاناتها. منها تُكتب الجولات بدقة.
// التشغيل: npx tsx scripts/map-screens.ts http://localhost:3100 > map.json  (بعد e2e:seed و next start)
import { readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const ROUTES = (process.env.ROUTES ?? "").split(",").filter(Boolean);

const DUMP = readFileSync(new URL("./map-dump.js", import.meta.url), "utf8");

async function dump(page: Page, scopeSel: string) {
  // نص خام حتى لا يضيف tsx دوال مساعدة غير موجودة في المتصفح
  return page.evaluate(`(${DUMP})(${JSON.stringify(scopeSel)})`) as Promise<string[]>;
}

async function main() {
  const base = process.argv[2] ?? "http://localhost:3100";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  await page.goto(`${base}/login`);
  await page.getByRole("textbox", { name: /رمز الشركة/ }).fill(process.env.CO ?? "home");
  await page.getByRole("textbox", { name: /اسم الدخول/ }).fill("admin");
  await page.getByRole("textbox", { name: /كلمة المرور/ }).fill(process.env.PASS ?? "e2e-admin-pass");
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  const result: Record<string, unknown> = {};
  for (const r of ROUTES) {
    try {
      await page.goto(base + r, { waitUntil: "networkidle" });
      const main = await dump(page, "main");
      const entry: Record<string, unknown> = { page: main };
      const dialog = '[role=dialog][aria-modal="true"], dialog[open]';
      if (await page.locator(dialog).count()) entry.openPanel = await dump(page, dialog);
      else {
        const add = page.locator("main a").filter({ hasText: /^\s*\+/ }).first();
        if (await add.count()) {
          const href = await add.getAttribute("href");
          await page.goto(base + href, { waitUntil: "networkidle" });
          if (await page.locator(dialog).count()) entry.panel = { href, items: await dump(page, dialog) };
          else entry.addPage = { href, items: await dump(page, "main") };
        }
      }
      result[r] = entry;
    } catch (e) {
      result[r] = { error: String(e).slice(0, 200) };
    }
  }
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
}
main();
