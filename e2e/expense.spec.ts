// مصروف السائق: لا يدخل المحاسبة قبل الاعتماد، والاعتماد بضغطتين يرحّل قيداً واحداً.
import { expect, test } from "@playwright/test";
import { driverPhone, officeLogin, PHOTO, sql, unbalancedEntries } from "./helpers";

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
