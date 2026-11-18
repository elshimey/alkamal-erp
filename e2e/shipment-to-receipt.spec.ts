// الدورة الأساسية كما يعملها المكتب والسائق: شحنة ← السائق يستلم ويحمّل ويسلّم ← اعتماد ← فاتورة ← سند قبض.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { driverPhone, expectToast, officeLogin, openId, PHOTO, pick, sql, unbalancedEntries } from "./helpers";

test("شحنة حتى التحصيل: كل خطوة تغيّر الحالة، والقيود متوازنة، والعميل مسدد", async ({ page, browser }) => {
  const shipper = `مصنع ${Date.now()}`;
  await officeLogin(page);

  // 1) المكتب ينشئ الشحنة: السعر من العقد والسائق من الإسناد
  await page.goto("/waybills?new=1");
  const form = page.getByRole("dialog");
  await pick(page, form, "العميل*", E2E.customer);
  await pick(page, form, /^المسار/, "مدينة الاختبار أ");
  await form.getByRole("combobox", { name: "المرسل*" }).fill(shipper);
  await page.keyboard.press("Tab");
  await form.getByRole("combobox", { name: "المستلم*" }).fill("مستودع الاختبار");
  await page.keyboard.press("Tab");
  await pick(page, form, "المركبة*", "1234");
  await form.getByRole("button", { name: "حفظ", exact: true }).click();
  await expectToast(page, /أُنشئت الشحنة WB-/);
  await page.waitForURL(/[?&]open=\d+/);
  const waybillId = openId(page);
  const [w] = await sql`select status, amount::float, driver_id from waybills where id = ${waybillId}`;
  expect(w).toMatchObject({ status: "draft", amount: E2E.price });
  expect(w.driver_id).not.toBeNull();

  // 2) الإرسال للسائق
  await page.getByRole("button", { name: "العمليات ▼" }).click();
  await page.getByRole("menuitem", { name: /إرسال للسائق/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "إرسال" }).click();
  await expectToast(page, /أُرسلت الشحنة/);

  // 3) السائق من جواله: استلمت ← تم التحميل (بصورة) ← تم التسليم (بصورة)
  const phone = await driverPhone(browser);
  await phone.goto(`/driver/trips/${waybillId}`);
  await phone.getByRole("button", { name: "استلمت الرحلة" }).click();
  await expect(phone.getByRole("button", { name: "تم التحميل" })).toBeVisible();
  await phone.locator("main input[type=file]").first().setInputFiles(PHOTO);
  await phone.getByRole("button", { name: "تم التحميل" }).click();
  await expect(phone.getByRole("button", { name: "تم التسليم" })).toBeVisible();
  expect((await sql`select status from waybills where id = ${waybillId}`)[0].status).toBe("in_transit");
  await phone.locator("main input[type=file]").first().setInputFiles(PHOTO);
  await phone.getByRole("button", { name: "تم التسليم" }).click();
  await expect.poll(async () => (await sql`select status from waybills where id = ${waybillId}`)[0].status).toBe("delivered");
  await phone.context().close();

  // 4) المكتب يعتمد: يُرحّل قيد التكلفة (عمولة السائق)
  await page.goto(`/waybills?open=${waybillId}`);
  await page.getByRole("button", { name: "العمليات ▼" }).click();
  await page.getByRole("menuitem", { name: /اعتماد الشحنة/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "اعتماد", exact: true }).click();
  await expectToast(page, "معتمدة");

  // 5) فاتورة مسودة ثم اعتماد وإصدار: قيد الإيراد والضريبة
  await page.getByRole("button", { name: "العمليات ▼" }).click();
  await page.getByRole("menuitem", { name: /إنشاء فاتورة مسودة/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "إنشاء المسودة" }).click();
  await page.waitForURL(/\/invoices\?open=\d+/);
  const invoiceId = openId(page);
  await page.getByRole("button", { name: "اعتماد وإصدار" }).click();
  await expect.poll(async () => (await sql`select status from sales_invoices where id = ${invoiceId}`)[0].status).toBe("issued");
  const [inv] = await sql`select number, status, total::float from sales_invoices where id = ${invoiceId}`;
  expect(inv).toMatchObject({ status: "issued", total: E2E.price * 1.15 });

  // 6) سند القبض بكامل رصيد العميل (التوزيع التلقائي يسدد الأقدم أولاً، فيشمل فاتورتنا)
  const [open] = await sql`select coalesce(sum(i.total - i.paid_amount), 0)::float as due from sales_invoices i
    join parties p on p.id = i.customer_id where i.status = 'issued' and p.name_ar = ${E2E.customer}`;
  await page.goto("/receipts/new");
  const main = page.locator("main");
  await pick(page, main, "العميل*", E2E.customer);
  await pick(page, main, /تم الدفع من خلال/, "الصندوق الرئيسي");
  await main.getByRole("textbox", { name: "المبلغ المستلم*" }).fill(open.due.toFixed(2));
  await main.getByRole("button", { name: "توزيع تلقائي" }).click();
  await main.getByRole("button", { name: "تسجيل", exact: true }).click();
  await page.waitForURL(/\/receipts\?open=\d+/);
  await expect(page.getByRole("heading", { name: /سند قبض/ })).toBeVisible();

  // النتيجة في الدفاتر
  const [paid] = await sql`select paid_amount::float from sales_invoices where id = ${invoiceId}`;
  expect(paid.paid_amount).toBe(inv.total);
  expect((await sql`select status from waybills where id = ${waybillId}`)[0].status).toBe("invoiced");
  const [ar] = await sql`select coalesce(sum(l.debit_base - l.credit_base), 0)::float as bal from journal_lines l
    join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id join parties p on p.id = l.party_id
    where e.status = 'posted' and a.code like '1103%' and p.name_ar = ${E2E.customer}`;
  expect(ar.bal).toBe(0);
  expect(await unbalancedEntries()).toEqual([]);
});

test("الضغط مرتين على «حفظ» ينشئ شحنة واحدة فقط", async ({ page }) => {
  const shipper = `ضغطتان ${Date.now()}`;
  await officeLogin(page);
  await page.goto("/waybills?new=1");
  const form = page.getByRole("dialog");
  await pick(page, form, "العميل*", E2E.customer);
  await pick(page, form, /^المسار/, "مدينة الاختبار أ");
  await form.getByRole("combobox", { name: "المرسل*" }).fill(shipper);
  await page.keyboard.press("Tab");
  await form.getByRole("combobox", { name: "المستلم*" }).fill("مستودع");
  await page.keyboard.press("Tab");
  await pick(page, form, "المركبة*", "1234");
  await form.getByRole("button", { name: "حفظ", exact: true }).dblclick();
  await expectToast(page, /أُنشئت الشحنة WB-/);
  await page.waitForTimeout(1500);
  expect((await sql`select count(*)::int as n from waybills where shipper = ${shipper}`)[0].n).toBe(1);
});
