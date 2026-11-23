// رسالة الرفض التي توجّه لصفحة أخرى تحمل رابطها (طلب أحمد 2026-11-23): إصدار فاتورة عليها مصروف «لم يُدفع بعد»
// يُرفض برسالة داخل نافذة التأكيد فيها رابط «سندات صرف تحت المراجعة» مصفّاة على الفاتورة، ورقم المستند يفتحه.
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { officeLogin, sql } from "./helpers";

test("رسالة منع الإصدار فيها رابط سندات صرف تحت المراجعة، ورقم المستند يفتحه", async ({ page }) => {
  const [inv] = await sql`select i.id, i.number from sales_invoices i join parties p on p.id = i.customer_id where p.name_ar = ${E2E.linkCustomer}`;
  await officeLogin(page);
  await page.goto("/invoices");
  const row = page.getByRole("row", { name: new RegExp(E2E.linkCustomer) });
  await row.getByRole("button", { name: "أصدرها" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "إصدار", exact: true }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("مصاريف على العميل لم تُعتمد بعد");
  await expect(alert).not.toContainText("](");
  await alert.getByRole("link", { name: "سندات صرف تحت المراجعة" }).click();
  await expect(page).toHaveURL(new RegExp(`/payments/review\\?tab=charges&invoice=${inv.id}`));
  await expect(page.getByRole("link", { name: "← العودة للفاتورة" })).toBeVisible();

  // رقم المستند في أي رسالة يفتح المستند نفسه
  await page.goto(`/go/${inv.number}`);
  await expect(page).toHaveURL(new RegExp(`/invoices/${inv.id}$`));
});
