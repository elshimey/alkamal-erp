import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { currentSchema, tenantClient } from "./tenant";

const url = process.env.DATABASE_URL ?? "postgres://erp:erp@localhost:5432/alkamal_erp";

// اتصال واحد يُعاد استخدامه أثناء التطوير بدل فتح اتصال جديد مع كل إعادة تحميل
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };
const client = globalForDb.pgClient ?? postgres(url, {
  // على الاستضافة السحابية كل نسخة تفتح اتصالات قليلة (عبر مجمّع الاتصالات)، تكفي لتشغيل استعلامات الصفحة متوازية
  // بدل انتظار كل استعلام دوره على اتصال واحد. و prepare معطّل ليعمل مع المجمّع (pooler)
  max: process.env.VERCEL ? 5 : 10,
  prepare: false,
});
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

// db يعمل على بيانات الشركة الحالية؛ baseSql للعمليات على مستوى المنصة (إنشاء الشركات وترحيلها)
export const baseSql = client;
// المستخدم الحالي لسجل التعديلات؛ خارج طلب ويب (سكربت أو اختبار) لا يوجد مستخدم
async function currentUserId(): Promise<number | null> {
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    return (await getCurrentUser())?.id ?? null;
  } catch {
    return null;
  }
}

export const db = drizzle(tenantClient(client, currentSchema, currentUserId), { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
