import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";

// صور مضغوطة في المتصفح قبل الرفع (أقصى بُعد 1280 بكسل)، فلا تتجاوز عادة 200 كيلوبايت
export const MAX_ATTACHMENT_BYTES = 1_500_000;
// صورة الوثيقة أو ملف PDF ممسوح
export const MAX_DOCUMENT_BYTES = 5_000_000;
export const ATTACHMENT_KINDS = {
  pod: "إثبات التسليم",
  odometer: "صورة العداد",
  fuel_receipt: "فاتورة الوقود",
  expense_receipt: "إيصال المصروف",
  document: "صورة الوثيقة",
  other: "صورة",
} as const;
export type AttachmentKind = keyof typeof ATTACHMENT_KINDS;

/** يحفظ صورة (أو PDF للوثائق) مرسلة كـ data URL. القيمة الفارغة لا تفعل شيئاً. */
export async function saveDataUrl(db: Db | Tx, input: { entity: string; entityId: number; kind: AttachmentKind; dataUrl: string | null | undefined; userId?: number }) {
  const isDoc = input.kind === "document";
  const m = input.dataUrl?.match(isDoc ? /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/ : /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) {
    if (input.dataUrl && isDoc) throw new Error("المرفق يجب أن يكون صورة أو PDF");
    return null;
  }
  const data = Buffer.from(m[2], "base64");
  if (data.length > (isDoc ? MAX_DOCUMENT_BYTES : MAX_ATTACHMENT_BYTES)) throw new Error(isDoc ? "الملف أكبر من 5 ميجابايت" : "الصورة كبيرة جداً");
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
