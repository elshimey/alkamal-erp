// جدول أقساط الدائنين (ملاحظة التشغيل 16): إنشاء الجدول بتوليد الأقساط، وتكلفة القسط الذي فات استحقاقه
// تُقيد فور الحفظ على 7101 ومركز المركبة، ثم «سداد» القسط بسند صرف «سداد قسط» يخصم حساب الدائن.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { officeLogin, pick, sql, unbalancedEntries } from "./helpers";

const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

test("جدول أقساط: توليد ← حفظ ← تكلفة المتأخر على 7101 ← سداد القسط بسند صرف", async ({ page }) => {
  await officeLogin(page);
  await page.goto("/payments/installments");
  await page.getByRole("link", { name: "+ جدول أقساط جديد" }).click();
  const form = page.getByRole("dialog");
  await form.locator("input[name=name]").fill("قرض اختبار المتصفح");
  await pick(page, form, /^حساب الدائن/, "2201");
  await pick(page, form, /^المركبة/, E2E.plate);

  // أول قسط قبل شهر: يصبح متأخراً وتُقيد تكلفته عند الحفظ
  const first = new Date();
  first.setUTCMonth(first.getUTCMonth() - 1);
  first.setUTCDate(10);
  await form.locator("[data-field=amount]").fill("1100");
  await form.locator("[data-field=cost]").fill("100");
  await form.locator("[data-field=count]").fill("3");
  const date = form.locator("[data-field=firstDate]");
  await date.fill(dmy(first));
  await date.press("Tab");
  await form.getByRole("button", { name: "توليد الأقساط" }).click();
  await expect(form.getByRole("textbox", { name: /^أصل القسط/ })).toHaveCount(3);
  await form.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect(page).toHaveURL(/\/payments\/installments\/\d+$/);

  const [plan] = await sql`select id from installment_plans where name = 'قرض اختبار المتصفح'`;
  const rows = await sql`select id, seq, principal::float as p, cost::float as c, cost_entry_id from installments where plan_id = ${plan.id} order by seq`;
  expect(rows.map((r) => [r.seq, r.p, r.c])).toEqual([[1, 1000, 100], [2, 1000, 100], [3, 1000, 100]]);
  expect(rows[0].cost_entry_id).not.toBeNull();
  const cost = await sql`select a.code, l.debit_base::float as d, l.credit_base::float as c, l.cost_center_id from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = ${rows[0].cost_entry_id} order by a.code`;
  expect(cost.find((l) => l.code === "2201")).toMatchObject({ c: 100 });
  expect(cost.find((l) => l.code === "7101")).toMatchObject({ d: 100 });
  expect(cost.find((l) => l.code === "7101")!.cost_center_id).not.toBeNull();

  // «سداد» القسط المتأخر: المبلغ الافتراضي هو القسط كاملاً
  const overdue = page.getByRole("row").filter({ hasText: "متأخر" }).first();
  await overdue.getByRole("button", { name: "سداد" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("input[name=amount]")).toHaveValue("1100.00");
  await dialog.getByRole("button", { name: "سداد", exact: true }).click();
  await expect.poll(async () => (await sql`select count(*)::int as n from installment_payments where installment_id = ${rows[0].id}`)[0].n).toBe(1);
  const [pv] = await sql`select p.kind, p.status, p.amount::float as amount, a.code from installment_payments ip join payments p on p.id = ip.payment_id join accounts a on a.id = p.debit_account_id where ip.installment_id = ${rows[0].id}`;
  expect(pv).toMatchObject({ kind: "installment", status: "posted", amount: 1100, code: "2201" });

  // القائمة: القسط المسدد لا يظهر في المستحق، والجدول بباقيه
  await page.goto("/payments/installments");
  await expect(page.getByRole("link", { name: "قرض اختبار المتصفح" }).first()).toBeVisible();
  expect(await unbalancedEntries()).toEqual([]);
});
