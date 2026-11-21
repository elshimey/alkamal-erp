// «وثائقي» في تطبيق السائق: وثيقة رفعها المكتب لمركبته تظهر في زر «المركبة»، وتفتح كاملة وتُنزَّل.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { driverPhone, PHOTO, sql } from "./helpers";

test("السائق يفتح وثيقة مركبته التي رفعها المكتب وينزّلها", async ({ browser }) => {
  const [v] = await sql`select id from vehicles where plate = ${E2E.plate}`;
  const [type] = await sql`select id from document_types where code = 'v_registration'`;
  const [doc] = await sql`insert into fleet_documents (document_type_id, vehicle_id, number, expiry_date) values (${type.id}, ${v.id}, 'REG-E2E', current_date + 400) returning id`;
  const data = readFileSync(PHOTO);
  const [file] = await sql`insert into attachments (entity, entity_id, kind, mime, size, data) values ('fleet_documents', ${doc.id}, 'document', 'image/jpeg', ${data.length}, ${data}) returning id`;

  const phone = await driverPhone(browser);
  await phone.goto("/driver/documents");
  const tabs = phone.getByRole("tab");
  await expect(tabs).toHaveText(["وثائقي", "المركبة", "المقطورة"]);
  await tabs.nth(1).click();
  await expect(phone.getByText(E2E.plate).first()).toBeVisible();
  await phone.getByRole("button", { name: /رخصة السير/ }).click();

  const viewer = phone.getByRole("dialog", { name: /رخصة السير/ });
  await expect(viewer.locator("img")).toBeVisible();
  const download = viewer.getByRole("link", { name: "تنزيل على الجوال" });
  const res = await phone.request.get((await download.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain(`document-${file.id}.jpg`);

  // Esc يغلق العارض
  await phone.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  // لا يفتح ملف وثيقة ليست له ولا لمركبته
  const [foreign] = await sql`insert into attachments (entity, entity_id, kind, mime, size, data) values ('fleet_documents', 999999, 'document', 'image/jpeg', ${data.length}, ${data}) returning id`;
  expect((await phone.request.get(`/driver/files/${foreign.id}`)).status()).not.toBe(200);
  await phone.context().close();
});
