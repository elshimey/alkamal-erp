import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
  // فاتورة الطرف الأول في رحلة بدأها السائق: داخلية للمكتب لا يراها العميل (قرار أحمد 2026-11-18)
  first_party_invoice: "فاتورة الطرف الأول",
  supplier_invoice: "صورة فاتورة المورد",
  other: "صورة",
} as const;
export type AttachmentKind = keyof typeof ATTACHMENT_KINDS;

/** يحفظ صورة (أو PDF للوثائق) مرسلة كـ data URL. القيمة الفارغة لا تفعل شيئاً. */
export async function saveDataUrl(db: Db | Tx, input: { entity: string; entityId: number; kind: AttachmentKind; dataUrl: string | null | undefined; userId?: number }) {
  const isDoc = input.kind === "document" || input.kind === "supplier_invoice";
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
    .select({ id: s.attachments.id, entityId: s.attachments.entityId, kind: s.attachments.kind, mime: s.attachments.mime, size: s.attachments.size, hiddenFromCustomer: s.attachments.hiddenFromCustomer, createdAt: s.attachments.createdAt })
    .from(s.attachments)
    .where(and(eq(s.attachments.entity, entity), inArray(s.attachments.entityId, ids)))
    .orderBy(desc(s.attachments.createdAt));
}

export async function getAttachment(db: Db | Tx, id: number) {
  const [row] = await db.select().from(s.attachments).where(eq(s.attachments.id, id));
  return row ?? null;
}

// ───────────── صور الرحلة للعميل ─────────────

/** صور مراحل الرحلة (التحميل والطريق والتسليم) هي ما يراه العميل؛ فواتير الديزل وإيصالات المصروفات داخلية. */
export const CUSTOMER_PHOTO_KINDS = ["other", "pod"] as const;
export const isCustomerPhoto = (kind: string) => (CUSTOMER_PHOTO_KINDS as readonly string[]).includes(kind);

export type CustomerPhoto = { id: number; waybillId: number; waybillNumber: string; kind: string; createdAt: Date };

/** صور الرحلة الظاهرة للعميل لشحنة أو عدة شحنات، بترتيب الشحنة ثم وقت الالتقاط. */
export async function customerPhotos(db: Db | Tx, waybillIds: number[]): Promise<CustomerPhoto[]> {
  if (!waybillIds.length) return [];
  return db
    .select({ id: s.attachments.id, waybillId: s.attachments.entityId, waybillNumber: s.waybills.number, kind: s.attachments.kind, createdAt: s.attachments.createdAt })
    .from(s.attachments)
    .innerJoin(s.waybills, eq(s.waybills.id, s.attachments.entityId))
    .where(
      and(
        eq(s.attachments.entity, "waybills"),
        inArray(s.attachments.entityId, waybillIds),
        inArray(s.attachments.kind, [...CUSTOMER_PHOTO_KINDS]),
        eq(s.attachments.hiddenFromCustomer, false),
      ),
    )
    .orderBy(asc(s.attachments.entityId), asc(s.attachments.createdAt), asc(s.attachments.id));
}

/** إخفاء صورة رحلة عن العميل أو إظهارها (صور مراحل الشحنة فقط). */
export async function setPhotoHidden(db: Db | Tx, waybillId: number, id: number, hidden: boolean) {
  const rows = await db
    .update(s.attachments)
    .set({ hiddenFromCustomer: hidden })
    .where(and(eq(s.attachments.id, id), eq(s.attachments.entity, "waybills"), eq(s.attachments.entityId, waybillId), inArray(s.attachments.kind, [...CUSTOMER_PHOTO_KINDS])))
    .returning({ id: s.attachments.id });
  if (!rows.length) throw new Error("الصورة غير موجودة في هذه الشحنة");
}
