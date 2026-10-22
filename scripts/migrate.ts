import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { ensurePlatform, migrateAllTenants } from "@/lib/platform";

// الترحيل يحتاج اتصالاً مباشراً لا يمر بمجمّع الاتصالات إن وُجد
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "postgres://erp:erp@localhost:5432/alkamal_erp";

async function main() {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  // سجل الشركات، ثم ترحيل مخطط كل شركة مشتركة بنفس الترحيلات
  await ensurePlatform(client);
  await migrateAllTenants(client);
  await client.end();
  console.log("✓ تم تحديث بنية قاعدة البيانات");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
