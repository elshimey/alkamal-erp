// الطباعة (ملاحظتا أحمد 2026-11-22 و2026-11-25): كل ما يُطبع يخرج كاملاً داخل الورقة، من الكمبيوتر أو الجوال:
// - لا عمود مثبت يركب فوق الأعمدة، ولا جدول مقصوص، ولا عنصر خارج الورقة، وعمود «م» في التقارير.
// - لا يختفي على الورق رقم ظاهر على الشاشة (صافي الربح والهامش اختفيا لأنهما زر «معادلة» والأزرار لا تُطبع).
// - لا صفحة فارغة بعد آخر سطر (ارتفاع الصفحة كان «ملء الشاشة» فيزيد عن الورقة).
// - القوائم تُطبع جدولاً لا بطاقات الجوال، والتفاصيل المطوية (مصاريف أخرى) تُفتح.
// يُفحص بعرض ورقة A4 الطولية (718 بكسل) والعرضية (1050) للتقارير العريضة، بعد فتح الصفحة بمقاس الكمبيوتر أو الجوال.
import { expect, test, type Page } from "@playwright/test";
import { REPORT_GROUPS } from "../src/data/reports";
import { officeLogin, sql } from "./helpers";

const CELLS = "main td, main th, main .drill, main .drill-card, main summary, main dd";

/** نص كل خلية ورقم كما يظهر (فارغ إن لم يظهر)، دون ما صُمم ألا يُطبع (print:hidden). */
const visibleTexts = (page: Page) =>
  page.$$eval(CELLS, (els) =>
    els.map((e) => {
      if (e.closest('[class*="print:hidden"]')) return "";
      const shown = (e as HTMLElement).getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
      return shown ? (e as HTMLElement).innerText.replace(/\s+/g, "") : "";
    }),
  );

/** يطبع الصفحة (وضع الطباعة بعرض الورقة) ويعيد ما خرج عن الورقة، وما كان ظاهراً على الشاشة واختفى على الورق. */
async function printCheck(page: Page) {
  const screen = await visibleTexts(page);
  const prev = page.viewportSize()!;
  // التقرير العريض يُطبع بالعرض (ReportHeader wide)
  const wide = await page.evaluate(() => [...document.querySelectorAll("style")].some((s) => /A4 landscape/.test(s.textContent ?? "")));
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: wide ? 1050 : 718, height: 1000 });
  const layout = await page.evaluate(() => {
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
    // صفحة فارغة بعد المحتوى: الصفحة أطول من آخر ما فيها
    const main = document.querySelector("main");
    const tail = main ? document.body.scrollHeight - (main.getBoundingClientRect().bottom + scrollY) : 0;
    if (getComputedStyle(document.body).minHeight !== "0px" || tail > 40) out.push(`صفحة زائدة بعد المحتوى (${Math.round(tail)})`);
    return [...new Set(out)].slice(0, 5);
  });
  const print = await visibleTexts(page);
  const lost = screen.flatMap((s, i) => (s && s.length > (print[i] ?? "").length ? [`${s.slice(0, 30)} ← ${(print[i] ?? "").slice(0, 30)}`] : [])).slice(0, 5);
  await page.setViewportSize(prev);
  await page.emulateMedia({ media: null });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  return { layout, lost };
}

const REPORTS = [...REPORT_GROUPS.flatMap((g) => g.reports.map((r) => r.href)), "/reports/fleet-profit?by=driver", "/reports/source?from=2026-01-01&p=4"];
const withFrom = (h: string) => (h.includes("from=") ? h : h.includes("?") ? `${h}&from=2026-01-01` : `${h}?from=2026-01-01`);

for (const device of ["الكمبيوتر", "الجوال"] as const) {
  test(`الطباعة من ${device}: كل تقرير والرئيسية كاملة داخل الورقة، دون رقم مختفٍ أو صفحة فارغة`, async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext(device === "الجوال" ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar", timezoneId: "Asia/Riyadh" } : { viewport: { width: 1440, height: 900 }, locale: "ar", timezoneId: "Asia/Riyadh" });
    const page = await ctx.newPage();
    await officeLogin(page);
    for (const u of ["/?from=2026-01-01", ...REPORTS.map(withFrom)]) {
      await page.goto(u);
      await page.waitForLoadState("networkidle");
      const r = await printCheck(page);
      expect(r.layout, `${u} (${device})`).toEqual([]);
      // على الجوال تُعرض بعض الأرقام بطاقات ثم جدولاً على الورق، فالمقارنة خلية بخلية للكمبيوتر
      if (device === "الكمبيوتر") expect(r.lost, `${u}: رقم ظاهر على الشاشة اختفى على الورق`).toEqual([]);
    }
    await ctx.close();
  });
}

test("الطباعة: الرقم المحسوب (صافي الربح والهامش) يُطبع، و«مصاريف أخرى» تُفتح بحساباتها، وعمود «م»", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/reports/cost-centers?from=2026-01-01");
  await page.emulateMedia({ media: "print" });
  // الخلية التي فيها زر المعادلة تبقى ظاهرة بنصها على الورق
  const formula = page.locator("main table button.drill").first();
  if (await formula.count()) {
    await expect(formula).toBeVisible();
    expect((await formula.innerText()).trim()).not.toBe("");
  }
  await page.emulateMedia({ media: null });

  await page.goto("/reports/fleet-profit?from=2026-01-01");
  const details = page.locator("main details[data-print-open]");
  if (await details.count()) {
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await expect(details.first()).toHaveAttribute("open", "");
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(details.first()).not.toHaveAttribute("open", "");
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

test("الطباعة: كل المستندات وصفحات التفاصيل داخل الورقة دون نقص", async ({ page }) => {
  test.setTimeout(180_000);
  await officeLogin(page);
  const id = async (table: string) => (await sql.unsafe(`select max(id) as id from ${table}`))[0]?.id as number | null;
  const urls: string[] = [];
  const DOCS: Record<string, string> = {
    waybills: "waybills",
    transport: "waybills",
    invoices: "sales_invoices",
    purchases: "purchase_invoices",
    receipts: "receipts",
    notes: "adjustment_notes",
    journal: "journal_entries",
    maintenance: "maintenance_orders",
    breakdowns: "breakdown_requests",
    handovers: "vehicle_handovers",
    violations: "traffic_violations",
    quotations: "quotations",
  };
  for (const [kind, table] of Object.entries(DOCS)) {
    const i = await id(table);
    if (i) urls.push(`/print/${kind}?ids=${i}`);
  }
  const wb = await id("waybills");
  const inv = await id("sales_invoices");
  const rc = await id("receipts");
  const jr = await id("journal_entries");
  if (wb) urls.push(`/waybills/${wb}`);
  if (inv) urls.push(`/invoices/${inv}`);
  if (rc) urls.push(`/receipts/${rc}`);
  if (jr) urls.push(`/journal/${jr}`);
  for (const u of urls) {
    await page.goto(u);
    await page.waitForLoadState("networkidle");
    const r = await printCheck(page);
    expect(r.layout, u).toEqual([]);
    if (u.startsWith("/print/")) expect(r.lost, `${u}: نقص على الورق`).toEqual([]);
  }
});

test("الطباعة: القوائم تُطبع جدولاً كاملاً داخل الورقة لا بطاقات الجوال", async ({ page }) => {
  test.setTimeout(180_000);
  await officeLogin(page);
  for (const u of ["/waybills", "/invoices", "/receipts", "/expenses", "/payments", "/vehicles", "/drivers", "/assignments", "/violations", "/payroll", "/parties", "/employees"]) {
    await page.goto(u);
    await page.waitForLoadState("networkidle");
    const r = await printCheck(page);
    expect(r.layout, u).toEqual([]);
    await page.emulateMedia({ media: "print" });
    await page.setViewportSize({ width: 718, height: 1000 });
    const shown = await page.evaluate(() => ({
      table: [...document.querySelectorAll("main table")].some((t) => t.getClientRects().length > 0),
      cards: [...document.querySelectorAll("main [data-doc-cards]")].some((c) => c.getClientRects().length > 0),
    }));
    expect(shown.cards, `${u}: بطاقات الجوال على الورق`).toBe(false);
    if (await page.locator("main table").count()) expect(shown.table, `${u}: الجدول لا يُطبع`).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ media: null });
  }
});
