// رحلة يبدؤها السائق من التطبيق ← المكتب يحوّلها لشحنة ويصدر فاتورتها فوراً.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { driverPhone, expectToast, officeLogin, PHOTO, pick, sql, unbalancedEntries } from "./helpers";

test("رحلة بدأها السائق تتحول لشحنة معتمدة وفاتورة صادرة بقيودها", async ({ page, browser }) => {
  const phone = await driverPhone(browser);
  await phone.goto("/driver/trips/new");
  await phone.locator("main input[type=file]").first().setInputFiles(PHOTO);
  await phone.getByRole("button", { name: "بدء الرحلة" }).click();
  await phone.waitForURL((u) => u.pathname === "/driver");
  await expect(phone.getByText("بانتظار المكتب").first()).toBeVisible();
  await phone.context().close();
  const [req] = await sql`select id, status from driver_trip_requests order by id desc limit 1`;
  expect(req.status).toBe("pending");
  // لا قيد قبل التحويل
  const entriesBefore = (await sql`select count(*)::int as n from journal_entries`)[0].n;

  await officeLogin(page);
  await page.goto(`/waybills/driver-requests?open=${req.id}`);
  await page.getByRole("link", { name: "تحويل لشحنة جديدة" }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByRole("combobox", { name: "المركبة*" })).toHaveValue(E2E.plate);
  await pick(page, form, "العميل*", E2E.customer);
  await pick(page, form, /^المسار/, "مدينة الاختبار أ");
  await form.getByRole("combobox", { name: "المرسل*" }).fill("مرسل رحلة السائق");
  await page.keyboard.press("Tab");
  await form.getByRole("combobox", { name: "المستلم*" }).fill("مستلم رحلة السائق");
  await page.keyboard.press("Tab");
  await form.getByRole("button", { name: /حفظ واعتماد وإصدار فاتورة فوراً/ }).click();
  await expectToast(page, /حُوّلت الرحلة إلى الشحنة WB-.*INV-/);

  const [done] = await sql`select r.status, w.status as waybill_status from driver_trip_requests r join waybills w on w.id = r.waybill_id where r.id = ${req.id}`;
  expect(done).toEqual({ status: "converted", waybill_status: "invoiced" });
  expect((await sql`select count(*)::int as n from journal_entries`)[0].n).toBeGreaterThan(entriesBefore);
  expect(await unbalancedEntries()).toEqual([]);
});
