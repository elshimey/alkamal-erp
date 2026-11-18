// يجهّز قاعدة اختبارات المتصفح (E2E_DATABASE_URL) من الصفر: يمسحها، يرحّلها، ويضيف بيانات أساسية
// لشركتين (الكمال وشركة «بيتا») حتى تجرّب الاختبارات الدورات كما يستخدمها العميل.
// لا تشغّله أبداً على قاعدة التشغيل: يمسح كل ما فيها.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { runInTenant, tenantClient } from "@/db/tenant";
import { ensureAdminUser, seedReferenceData } from "@/lib/seed";
import { createTenant, ensurePlatform } from "@/lib/platform";
import { createContract, createLocation, createParty, createRoute, setContractStatus } from "@/lib/operations";
import { assignVehicle, createDriver, createVehicle } from "@/lib/fleet";
import { createDriverLogin } from "@/lib/driver-app";
import { E2E } from "./data";

async function main() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url || !/_e2e\b/.test(url)) throw new Error("E2E_DATABASE_URL يجب أن يشير لقاعدة اسمها ينتهي بـ _e2e");
  const client = postgres(url, { max: 2, onnotice: () => {} });
  await client`drop schema if exists public cascade`;
  await client`drop schema if exists drizzle cascade`;
  await client`drop schema if exists platform cascade`;
  for (const r of await client`select nspname from pg_namespace where nspname like 't\\_%'`) await client.unsafe(`drop schema "${r.nspname}" cascade`);
  await client`create schema public`;
  const db = drizzle(client, { schema: s }) as unknown as Db;
  await migrate(db, { migrationsFolder: "drizzle" });
  const year = Number(new Date().toISOString().slice(0, 4));
  await seedReferenceData(db, year);
  await ensurePlatform(client);
  await ensureAdminUser(db, E2E.admin.login, E2E.admin.password);

  // بيانات الكمال الأساسية: مسار وعميل بعقد ساري ومركبة مسندة لسائق له دخول للتطبيق
  const [sa] = await db.select().from(s.locations).where(eq(s.locations.countryCode, "SA"));
  const from = await createLocation(db, { parentId: sa.id, nameAr: "مدينة الاختبار أ" });
  const to = await createLocation(db, { parentId: sa.id, nameAr: "مدينة الاختبار ب" });
  const route = await createRoute(db, { fromLocationId: from.id, toLocationId: to.id, distanceKm: 300, driverCommission: 150 });
  const customer = await createParty(db, { nameAr: E2E.customer, roles: ["customer"] });
  const contract = await createContract(db, { customerId: customer.id, number: "E2E-1", fromDate: `${year}-01-01`, toDate: `${year}-12-31` });
  await db.insert(s.contractRates).values({ contractId: contract.id, method: "route_fixed", routeId: route.id, price: String(E2E.price) });
  await setContractStatus(db, contract.id, "active");
  const vehicle = await createVehicle(db, { plate: E2E.plate, chassis: "E2E-CH-1", odometer: 1000 });
  const driver = await createDriver(db, { nameAr: E2E.driver.name, mobile: E2E.driver.login, appLanguage: "ar" });
  await assignVehicle(db, { vehicleId: vehicle.id, driverId: driver.id, fromDate: `${year}-01-01` });
  await createDriverLogin(db, { driverId: driver.id, login: E2E.driver.login, password: E2E.driver.password });

  // شركة ثانية ببيانات سرية: لا يجب أن تظهر لمستخدمي الكمال ولا العكس
  const tdb = drizzle(tenantClient(client), { schema: s }) as unknown as Db;
  await createTenant(client, tdb, { name: "شركة بيتا", slug: E2E.beta.code, trialDays: 15, adminName: "مدير بيتا", adminLogin: E2E.beta.login, adminPassword: E2E.beta.password });
  await runInTenant(`t_${E2E.beta.code}`, () => createParty(tdb, { nameAr: E2E.beta.secretCustomer, roles: ["customer"] }));

  await client.end();
  console.log("✓ قاعدة اختبارات المتصفح جاهزة");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
