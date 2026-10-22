import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { tenantClient } from "./tenant";

const url = process.env.DATABASE_URL ?? "postgres://erp:erp@localhost:5432/alkamal_erp";

// اتصال واحد يُعاد استخدامه أثناء التطوير بدل فتح اتصال جديد مع كل إعادة تحميل
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };
const client = globalForDb.pgClient ?? postgres(url, {
  // على الاستضافة السحابية كل نسخة تفتح اتصالات قليلة، و prepare معطّل ليعمل مع مجمّع الاتصالات (pooler)
  max: process.env.VERCEL ? 1 : 10,
  prepare: false,
});
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

// db يعمل على بيانات الشركة الحالية؛ baseSql للعمليات على مستوى المنصة (إنشاء الشركات وترحيلها)
export const baseSql = client;
export const db = drizzle(tenantClient(client), { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
