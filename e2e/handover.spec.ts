// محضر استلام وتسليم المركبة (طلب أحمد 2026-11-24): النوع أولاً، والعدد والأدوات، والمعاينة بجانب النموذج،
// والمحضر برقمه يُطبع بالعربي والإنجليزي. يعيد الإسناد كما كان (تسليم للشركة ثم استلام لنفس السائق).
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { officeLogin, pick, sql } from "./helpers";

test("تسليم للشركة بأدواته ثم استلام، والمحضر يُطبع", async ({ page }) => {
  await officeLogin(page);
  const [a] = await sql`select va.id from vehicle_assignments va join vehicles v on v.id = va.vehicle_id where v.plate = ${E2E.plate} and va.to_date is null`;
  test.skip(!a, "المركبة غير مسندة");
  await page.goto(`/assignments?release=${a.id}`);
  const form = page.getByRole("dialog");
  await expect(form.getByRole("heading", { name: "محضر تسليم مركبة للشركة", exact: true })).toBeVisible();
  await expect(form.getByText(/السائق الحالي \(المسلِّم\)/)).toBeVisible();
  await form.getByRole("button", { name: "+ إطار احتياطي" }).click();
  await form.getByRole("button", { name: "+ إضافة صنف" }).click();
  await form.getByLabel("الصنف", { exact: true }).last().fill("صنف اختبار المحضر");
  await form.getByRole("spinbutton", { name: "العدد" }).last().fill("2");
  // المعاينة تتغير مع الكتابة
  await expect(form.getByText("صنف اختبار المحضر").last()).toBeVisible();
  await expect(form.getByText("Vehicle Return to Company")).toBeVisible();
  await form.getByRole("button", { name: "حفظ", exact: true }).click();
  await page.waitForURL(/[?&]doc=\d+/);
  const docId = Number(new URL(page.url()).searchParams.get("doc"));
  await expect(page.getByRole("link", { name: "طباعة المحضر" }).first()).toBeVisible();
  const [h] = await sql`select number, kind, closed_assignment_id from vehicle_handovers where id = ${docId}`;
  expect(h).toMatchObject({ kind: "return", closed_assignment_id: a.id });
  const items = await sql`select name, qty from vehicle_handover_items where handover_id = ${docId} order by line_no`;
  expect(items.map((i) => `${i.name}:${i.qty}`)).toEqual(["إطار احتياطي:1", "صنف اختبار المحضر:2"]);

  // الاستلام من جديد لنفس السائق (يعيد الإسناد لباقي الاختبارات)
  await page.goto("/assignments?new=1");
  const f2 = page.getByRole("dialog");
  await expect(f2.getByRole("heading", { name: "محضر استلام مركبة", exact: true })).toBeVisible();
  await pick(page, f2, /^المركبة/, "1234");
  await pick(page, f2, /^السائق المستلم/, E2E.driver.name);
  await expect(f2.getByText(/أقر أنا السائق سائق الاختبار بأنني استلمت/)).toBeVisible();
  await f2.getByRole("button", { name: "حفظ", exact: true }).click();
  await page.waitForURL(/[?&]doc=\d+/);
  const [open] = await sql`select va.id from vehicle_assignments va join vehicles v on v.id = va.vehicle_id where v.plate = ${E2E.plate} and va.to_date is null`;
  expect(open).toBeTruthy();

  // صفحة الطباعة
  await page.goto(`/print/handovers?ids=${docId}`);
  await expect(page.getByText(h.number).first()).toBeVisible();
  await expect(page.getByText("التوقيع").or(page.getByText("السائق المسلِّم")).first()).toBeVisible();
});

test("نافذة المحضر على الجوال دون سحب جانبي، والمعاينة تحت النموذج", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar" });
  const page = await ctx.newPage();
  await officeLogin(page);
  await page.goto("/assignments?new=1");
  const form = page.getByRole("dialog");
  await form.getByRole("radio", { name: /تسليم لسائق آخر/ }).click();
  await expect(form.getByRole("heading", { name: "محضر تسليم مركبة لسائق آخر", exact: true })).toBeVisible();
  await expect(form.getByText("Vehicle Handover to Another Driver")).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide).toBeLessThanOrEqual(1);
  await ctx.close();
});

test("إسناد سابق بلا محضر: إنشاء محضره من الصف ثم تعديله وطباعته", async ({ page }) => {
  await officeLogin(page);
  const [a] = await sql`select va.id from vehicle_assignments va
    where not exists (select 1 from vehicle_handovers h where h.assignment_id = va.id) order by va.id limit 1`;
  test.skip(!a, "لا يوجد إسناد سابق بلا محضر");
  await page.goto("/assignments");
  await page.locator(`a[href="/assignments?prep=${a.id}&side=opened"]:visible`).first().click();
  const form = page.getByRole("dialog");
  await expect(form.getByRole("heading", { name: /محضر لإسناد سابق/ })).toBeVisible();
  await form.getByRole("button", { name: "+ طفاية حريق" }).click();
  await form.getByRole("radio", { name: "ثلاثة أرباع" }).click();
  await form.getByRole("button", { name: "حفظ", exact: true }).click();
  await page.waitForURL(/[?&]doc=\d+/);
  const docId = Number(new URL(page.url()).searchParams.get("doc"));
  const [h] = await sql`select number, kind, assignment_id, fuel_level from vehicle_handovers where id = ${docId}`;
  expect(h).toMatchObject({ assignment_id: a.id, fuel_level: "three_quarters" });

  // التعديل من شريط المحضر، والمعاينة تتغير، ثم الحفظ يعود للمحضر نفسه
  await page.getByRole("link", { name: "تعديل المحضر" }).click();
  const f2 = page.getByRole("dialog");
  await expect(f2.getByRole("heading", { name: `تعديل المحضر ${h.number}` })).toBeVisible();
  await f2.getByRole("textbox", { name: "ملاحظات" }).fill("خدش في الباب الأيمن");
  await expect(f2.getByText("خدش في الباب الأيمن").last()).toBeVisible();
  await f2.getByRole("button", { name: "حفظ", exact: true }).click();
  await page.waitForURL(new RegExp(`[?&]doc=${docId}`));
  const [after] = await sql`select notes, (select count(*)::int from vehicle_handover_items where handover_id = ${docId}) as n from vehicle_handovers where id = ${docId}`;
  expect(after).toMatchObject({ notes: "خدش في الباب الأيمن", n: 1 });
  await page.goto(`/print/handovers?ids=${docId}`);
  await expect(page.getByText("خدش في الباب الأيمن").first()).toBeVisible();
});
