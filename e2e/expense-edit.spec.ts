// تعديل المصروفات وسندات الصرف (طلب أحمد 2026-11-24): النافذة نفسها للتعديل، والمعتمد يُعاد ترحيل قيده،
// والورقة تضيف سطوراً جديدة والتاريخ يُختار من التقويم.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { officeLogin, pick, sql, unbalancedEntries } from "./helpers";

const creditOf = async (entryId: number, prefix: string) =>
  (await sql`select coalesce(sum(l.credit_base), 0)::float as c from journal_lines l join accounts a on a.id = l.account_id
    where l.entry_id = ${entryId} and a.code like ${prefix + "%"}`)[0].c;

test("مصروف معتمد يُفتح من «تعديل» ويُعاد ترحيل قيده بالمبلغ الجديد", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/expenses?new=1");
  const form = page.getByRole("dialog");
  await pick(page, form, /^نوع المصروف/, "5101");
  await form.locator("input[name=amount]").fill("200");
  await pick(page, form, /^السائق/, E2E.driver.name);
  await form.getByText("الشركة", { exact: true }).click();
  await form.locator("input[name=vendor]").fill("محطة التعديل");
  await form.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect.poll(async () => (await sql`select count(*)::int as n from expenses where vendor_name = 'محطة التعديل'`)[0].n).toBe(1);
  const [e] = await sql`select id, number, status, journal_entry_id from expenses where vendor_name = 'محطة التعديل'`;
  expect(e.status).toBe("approved");

  await page.goto("/expenses");
  await page.getByRole("row", { name: new RegExp(e.number) }).getByRole("link", { name: "تعديل" }).click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByText(`تعديل المصروف ${e.number}`)).toBeVisible();
  await expect(edit.locator("input[name=amount]")).toHaveValue(/^200/);
  await edit.locator("input[name=amount]").fill("260");
  await edit.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect.poll(async () => Number((await sql`select amount from expenses where id = ${e.id}`)[0].amount)).toBe(260);
  const [after] = await sql`select status, journal_entry_id from expenses where id = ${e.id}`;
  expect(after.status).toBe("approved");
  expect(after.journal_entry_id).not.toBe(e.journal_entry_id);
  expect(await creditOf(after.journal_entry_id, "1101")).toBe(260);
  expect(await unbalancedEntries()).toEqual([]);
});

test("ورقة المصروفات: سطر جديد، والتاريخ من التقويم، ويُحفظ مصروفاً معتمداً", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/expenses?view=sheet");
  await page.getByRole("button", { name: "+ مصروف جديد" }).first().click();
  const row = page.locator("table[data-report='الورقة'] tbody tr").last();
  const cell = (i: number) => row.locator("td").nth(i + 1);
  await expect(row.getByText("جديد")).toBeVisible();
  // خلية التاريخ تفتح التقويم مباشرة
  await cell(2).click();
  const calendar = page.getByRole("dialog");
  await expect(calendar.getByRole("button", { name: "اليوم" })).toBeVisible();
  await calendar.getByRole("button", { name: "اليوم" }).click();
  await expect(calendar).toBeHidden();
  // نوع المصروف والسائق (يملأ مركبته) والبيان والمبلغ
  await cell(3).click();
  await page.keyboard.type("5101");
  await page.getByRole("option", { name: /5101/ }).first().click();
  await cell(5).click();
  await page.keyboard.type(E2E.driver.name);
  await page.getByRole("option", { name: new RegExp(E2E.driver.name) }).first().click();
  await cell(4).click();
  await page.keyboard.type("ديزل من الورقة");
  await page.keyboard.press("Enter");
  await cell(11).click();
  await page.keyboard.type("120");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /حفظ التعديلات/ }).click();
  await expect.poll(async () => (await sql`select count(*)::int as n from expenses where description = 'ديزل من الورقة'`)[0].n).toBe(1);
  const [e] = await sql`select e.status, e.amount, e.journal_entry_id, v.plate from expenses e left join vehicles v on v.id = e.vehicle_id where e.description = 'ديزل من الورقة'`;
  expect(e).toMatchObject({ status: "approved", plate: E2E.plate });
  expect(Number(e.amount)).toBe(120);
  expect(await creditOf(e.journal_entry_id, "1101")).toBe(120);
  expect(await unbalancedEntries()).toEqual([]);
});

test("سند صرف من نافذة واحدة: حفظ وترحيل، ثم تعديل المرحّل يعيد ترحيله", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/payments?new=1");
  const form = page.getByRole("dialog");
  await form.getByText("صرف عهدة لسائق", { exact: true }).click();
  await pick(page, form, /^السائق/, E2E.driver.name);
  await form.locator("input[name=amount]").fill("300");
  await form.locator("input[name=reference]").fill("PAY-EDIT-1");
  await form.getByRole("button", { name: "حفظ وترحيل" }).click();
  await expect.poll(async () => (await sql`select count(*)::int as n from payments where reference = 'PAY-EDIT-1'`)[0].n).toBe(1);
  const [p] = await sql`select id, number, status, journal_entry_id from payments where reference = 'PAY-EDIT-1'`;
  expect(p.status).toBe("posted");

  await page.goto(`/payments?edit=${p.id}`);
  const edit = page.getByRole("dialog");
  await expect(edit.getByText(`تعديل سند الصرف ${p.number}`)).toBeVisible();
  await edit.locator("input[name=amount]").fill("350");
  await edit.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect.poll(async () => Number((await sql`select amount from payments where id = ${p.id}`)[0].amount)).toBe(350);
  const [after] = await sql`select status, journal_entry_id from payments where id = ${p.id}`;
  expect(after.status).toBe("posted");
  expect(await creditOf(after.journal_entry_id, "1101")).toBe(350);
  expect(await unbalancedEntries()).toEqual([]);
});
