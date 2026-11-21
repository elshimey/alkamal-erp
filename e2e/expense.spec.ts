// مصروف السائق: لا يدخل المحاسبة قبل الاعتماد، والاعتماد بضغطتين يرحّل قيداً واحداً.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { driverPhone, officeLogin, pick, PHOTO, sql, unbalancedEntries } from "./helpers";

test("مصروف من تطبيق السائق ← مراجعة واعتماد ← قيد واحد على المركبة وعهدة السائق", async ({ page, browser }) => {
  const phone = await driverPhone(browser);
  await phone.goto("/driver/expenses");
  const main = phone.locator("main");
  await main.getByText("طريق ورسوم", { exact: true }).click();
  await main.getByRole("textbox", { name: /المبلغ الإجمالي/ }).fill("115");
  await main.locator("input[type=file]").first().setInputFiles(PHOTO);
  await main.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(main.getByText("تم الحفظ")).toBeVisible();
  await phone.context().close();

  // قبل الاعتماد: معلّق ولا قيد له
  const [e] = await sql`select id, number, status, journal_entry_id from expenses order by id desc limit 1`;
  expect(e).toMatchObject({ status: "pending", journal_entry_id: null });
  const entriesBefore = (await sql`select count(*)::int as n from journal_entries`)[0].n;

  await officeLogin(page);
  await page.goto("/expenses?status=pending");
  await page.getByRole("row", { name: new RegExp(e.number) }).getByRole("button", { name: "مراجعة واعتماد" }).click();
  // ضغطتان سريعتان على الاعتماد (مثل مستخدم مستعجل)
  await page.getByRole("dialog").getByRole("button", { name: "اعتماد وترحيل القيد" }).dblclick();
  await expect.poll(async () => (await sql`select status from expenses where id = ${e.id}`)[0].status).toBe("approved");
  await page.waitForTimeout(1500);

  const [after] = await sql`select journal_entry_id from expenses where id = ${e.id}`;
  expect(after.journal_entry_id).not.toBeNull();
  expect((await sql`select count(*)::int as n from journal_entries`)[0].n).toBe(entriesBefore + 1);
  const lines = await sql`select a.code, l.debit_base::float as d, l.credit_base::float as c, l.cost_center_id from journal_lines l
    join accounts a on a.id = l.account_id where l.entry_id = ${after.journal_entry_id} order by a.code`;
  expect(lines.find((l) => l.code === "5112")).toMatchObject({ d: 115 });
  expect(lines.find((l) => l.code === "5112")!.cost_center_id).not.toBeNull();
  expect(lines.find((l) => l.code.startsWith("1105"))).toMatchObject({ c: 115 });
  expect(await unbalancedEntries()).toEqual([]);
});

test("نموذج المصروف الواحد: السائق يملأ مركبته، ودفع الشركة يُقيد على المركبة فور الحفظ", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/expenses");
  await page.getByRole("link", { name: "+ مصروف جديد" }).click();
  const form = page.getByRole("dialog");
  await pick(page, form, /^نوع المصروف/, "5101");
  await form.locator("input[name=amount]").fill("250");
  await pick(page, form, /^السائق/, E2E.driver.name);
  await expect(form.getByRole("combobox", { name: /^المركبة/ })).toHaveValue(E2E.plate);
  // خانات الدافع تظهر حسب الاختيار
  await expect(form.getByRole("combobox", { name: /^المستفيد/ })).toBeHidden();
  await form.getByText("لم يُدفع بعد", { exact: true }).click();
  await expect(form.getByRole("combobox", { name: /^المستفيد/ })).toBeVisible();
  await form.getByText("الشركة", { exact: true }).click();
  await expect(form.getByRole("combobox", { name: /^دُفع من/ })).toBeVisible();
  await form.locator("input[name=vendor]").fill("محطة الاختبار");
  await form.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect.poll(async () => (await sql`select count(*)::int as n from expenses where vendor_name = 'محطة الاختبار'`)[0].n).toBe(1);
  const [e] = await sql`select e.status, e.payer, e.driver_id, e.cost_center_id, e.journal_entry_id, v.plate from expenses e left join vehicles v on v.id = e.vehicle_id where e.vendor_name = 'محطة الاختبار'`;
  expect(e).toMatchObject({ status: "approved", payer: "cash", plate: E2E.plate });
  expect(e.driver_id).not.toBeNull();
  expect(e.cost_center_id).not.toBeNull();
  expect(await unbalancedEntries()).toEqual([]);
});
