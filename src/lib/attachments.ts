import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";

// صور مضغوطة في المتصفح قبل الرفع (أقصى بُعد 1280 بكسل)، فلا تتجاوز عادة 200 كيلوبايت
export const MAX_ATTACHMENT_BYTES = 1_500_000;
export const ATTACHMENT_KINDS = {
  pod: "إثبات التسليم",
  odometer: "صورة العداد",
  fuel_receipt: "فاتورة الوقود",
  expense_receipt: "إيصال المصروف",
  other: "صورة",
} as const;
export type AttachmentKind = keyof typeof ATTACHMENT_KINDS;

/** يحفظ صورة مرسلة كـ data URL. القيمة الفارغة لا تفعل شيئاً. */
export async function saveDataUrl(db: Db | Tx, input: { entity: string; entityId: number; kind: AttachmentKind; dataUrl: string | null | undefined; userId?: number }) {
  const m = input.dataUrl?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const data = Buffer.from(m[2], "base64");
  if (data.length > MAX_ATTACHMENT_BYTES) throw new Error("الصورة كبيرة جداً");
  const [row] = await db
    .insert(s.attachments)
    .values({ entity: input.entity, entityId: input.entityId, kind: input.kind, mime: m[1], size: data.length, data, createdBy: input.userId ?? null })
    .returning({ id: s.attachments.id });
  return row.id;
}

/** المرفقات (دون البيانات) لسجل أو عدة سجلات. */
export async function listAttachments(db: Db | Tx, entity: string, ids: number[]) {
  if (!ids.length) return [];
  return db
    .select({ id: s.attachments.id, entityId: s.attachments.entityId, kind: s.attachments.kind, size: s.attachments.size, createdAt: s.attachments.createdAt })
    .from(s.attachments)
    .where(and(eq(s.attachments.entity, entity), inArray(s.attachments.entityId, ids)))
    .orderBy(desc(s.attachments.createdAt));
}

export async function getAttachment(db: Db | Tx, id: number) {
  const [row] = await db.select().from(s.attachments).where(eq(s.attachments.id, id));
  return row ?? null;
}

/** ينفذ العملية مرة واحدة لكل معرّف من تطبيق السائق؛ الإرسال المكرر (بعد انقطاع الشبكة) يُتجاهل. */
export async function onceForOp(db: Db, opId: string | null | undefined, fn: () => Promise<void>) {
  if (!opId || !/^[A-Za-z0-9-]{8,40}$/.test(opId)) return fn();
  const [done] = await db.select().from(s.clientOps).where(eq(s.clientOps.opId, opId));
  if (done) return;
  await fn();
  await db.insert(s.clientOps).values({ opId }).onConflictDoNothing();
}
