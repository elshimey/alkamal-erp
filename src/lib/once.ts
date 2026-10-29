import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";

const validOp = (id: string | null | undefined): id is string => !!id && /^[A-Za-z0-9-]{8,40}$/.test(id);

/**
 * ينفذ عملية تغيّر مالاً أو مخزوناً مرة واحدة لكل معرّف إرسال يحمله النموذج.
 * إعادة الإرسال (ضغطتان، أو انقطاع الرد ثم المحاولة) تعيد نتيجة المرة الأولى ولا تسجّلها مرتين.
 * المعرّف يُحجز قبل التنفيذ فلا يمر طلبان متزامنان معاً، وإن فشلت العملية يُفك الحجز لتُعاد بعد التصحيح.
 * بلا معرّف صالح تُنفذ العملية عادياً.
 */
export async function once<T>(db: Db, opId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  if (!validOp(opId)) return fn();
  const claimed = await db.insert(s.clientOps).values({ opId }).onConflictDoNothing().returning({ opId: s.clientOps.opId });
  if (!claimed.length) {
    const [done] = await db.select({ result: s.clientOps.result }).from(s.clientOps).where(eq(s.clientOps.opId, opId));
    if (!done?.result) throw new Error("هذه العملية قيد الحفظ الآن؛ حدّث الصفحة بعد لحظات للتأكد منها");
    return done.result.v as T;
  }
  let result: T;
  try {
    result = await fn();
  } catch (err) {
    await db.delete(s.clientOps).where(eq(s.clientOps.opId, opId));
    throw err;
  }
  await db.update(s.clientOps).set({ result: { v: result ?? null } }).where(eq(s.clientOps.opId, opId));
  return result;
}

/** لتطبيق السائق: ما حُفظ دون إنترنت ثم أُعيد إرساله لا يُسجَّل مرتين. */
export async function onceForOp(db: Db, opId: string | null | undefined, fn: () => Promise<void>) {
  await once(db, opId, fn);
}
