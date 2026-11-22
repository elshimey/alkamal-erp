// الطباعة (ملاحظة أحمد 2026-11-22): كل تقرير ومستند يُطبع داخل عرض الورقة، بلا عمود مثبت يركب فوق الأعمدة،
// بلا جدول مقصوص، وبعمود «م» للتسلسل في التقارير. يُفحص بعرض ورقة A4 الطولية (718 بكسل) كما يطبع الجوال والكمبيوتر.
import { expect, test, type Page } from "@playwright/test";
import { REPORT_GROUPS } from "../src/data/reports";
import { officeLogin, sql } from "./helpers";

async function printIssues(page: Page) {
  await page.emulateMedia({ media: "print" });
  const issues = await page.evaluate(() => {
    const out: string[] = [];
    const W = document.documentElement.clientWidth;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || el.getClientRects().length === 0) continue;
      const name = `${el.tagName}.${String(el.className).slice(0, 40)}`;
      if (cs.position === "sticky" || cs.position === "fixed") out.push(`مثبت ${name}`);
      if (["auto", "scroll", "hidden"].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 2) out.push(`مقصوص ${name}`);
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > W + 2 || r.left < -2)) out.push(`خارج الورقة ${name}`);
    }
    return [...new Set(out)].slice(0, 5);
  });
  await page.emulateMedia({ media: null });
  return issues;
}

test("الطباعة: كل تقرير داخل الورقة دون تداخل، وفيه عمود «م»", async ({ page }) => {
  test.setTimeout(240_000);
  await officeLogin(page);
  await page.setViewportSize({ width: 718, height: 1000 });
  for (const r of REPORT_GROUPS.flatMap((g) => g.reports)) {
    await page.goto(r.href.includes("?") ? `${r.href}&from=2026-01-01` : `${r.href}?from=2026-01-01`);
    await page.waitForLoadState("networkidle");
    expect(await printIssues(page), r.href).toEqual([]);
  }
  await page.goto("/reports/trial-balance?from=2026-01-01");
  const serial = await page.evaluate(() => {
    const t = document.querySelector("table[data-report]")!;
    const head = getComputedStyle(t.querySelector("thead tr")!, "::before").content;
    const row = [...t.querySelectorAll("tbody tr")].map((tr) => getComputedStyle(tr, "::before").content).find((c) => c !== '""' && c !== "none");
    return { head, row };
  });
  expect(serial.head).toBe('"م"');
  expect(serial.row).toContain("counter");
});

test("الطباعة: المستندات وصفحات التفاصيل داخل الورقة دون تداخل", async ({ page }) => {
  test.setTimeout(120_000);
  await officeLogin(page);
  await page.setViewportSize({ width: 718, height: 1000 });
  const id = async (table: string) => (await sql.unsafe(`select max(id) as id from ${table}`))[0]?.id as number | null;
  const urls: string[] = [];
  const wb = await id("waybills");
  const inv = await id("sales_invoices");
  const rc = await id("receipts");
  const jr = await id("journal_entries");
  if (wb) urls.push(`/waybills/${wb}`, `/print/waybills?ids=${wb}`, `/print/transport?ids=${wb}`);
  if (inv) urls.push(`/invoices/${inv}`, `/print/invoices?ids=${inv}`);
  if (rc) urls.push(`/receipts/${rc}`, `/print/receipts?ids=${rc}`);
  if (jr) urls.push(`/journal/${jr}`, `/print/journal?ids=${jr}`);
  for (const u of urls) {
    await page.goto(u);
    await page.waitForLoadState("networkidle");
    expect(await printIssues(page), u).toEqual([]);
  }
});
