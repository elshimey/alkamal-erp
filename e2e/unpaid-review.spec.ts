// «لم يُدفع بعد»: لا قيد قبل الاعتماد، والاعتماد من «سندات صرف تحت المراجعة» يقيد الالتزام (2106)،
// والسداد ينشئ سند صرف مرحّلاً يقفله.
import { expect, test } from "@playwright/test";
import { officeLogin, sql, unbalancedEntries } from "./helpers";

test("مصروف «لم يُدفع بعد» ← اعتماد من سندات صرف تحت المراجعة ← سداد بسند صرف", async ({ page }) => {
  const [account] = await sql`select id from accounts where code like '6%' and is_postable and is_active and not requires_cost_center order by code limit 1`;
  const [e] = await sql`insert into expenses (number, expense_date, payer, account_id, description, amount)
    values ('EX-E2E-UNPAID', current_date, 'unpaid', ${account.id}, 'كهرباء المكتب', 340) returning id`;

  await officeLogin(page);
  await page.goto("/payments/review?tab=expenses");
  const row = page.getByRole("row", { name: /EX-E2E-UNPAID/ });
  await expect(row.getByText("بانتظار الاعتماد")).toBeVisible();
  await row.getByRole("button", { name: "اعتماد" }).click();
  await expect.poll(async () => (await sql`select status from expenses where id = ${e.id}`)[0].status).toBe("approved");
  const [approved] = await sql`select journal_entry_id from expenses where id = ${e.id}`;
  const accrual = await sql`select a.code, l.credit_base::float as c from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = ${approved.journal_entry_id}`;
  expect(accrual.find((l) => l.code === "2106")).toMatchObject({ c: 340 });

  await page.getByRole("row", { name: /EX-E2E-UNPAID/ }).getByRole("button", { name: "سداد" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "سداد", exact: true }).click();
  await expect.poll(async () => (await sql`select payment_id from expenses where id = ${e.id}`)[0].payment_id).not.toBeNull();
  const [paid] = await sql`select p.status, p.kind from expenses e join payments p on p.id = e.payment_id where e.id = ${e.id}`;
  expect(paid).toMatchObject({ status: "posted", kind: "expense" });
  await page.goto("/payments/review?tab=expenses");
  await expect(page.getByRole("row", { name: /EX-E2E-UNPAID/ })).toHaveCount(0);
  expect(await unbalancedEntries()).toEqual([]);
});
