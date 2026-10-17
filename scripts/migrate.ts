import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://erp:erp@localhost:5432/alkamal_erp";

async function main() {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();
  console.log("✓ تم تحديث بنية قاعدة البيانات");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
