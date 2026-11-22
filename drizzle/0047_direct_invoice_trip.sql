-- الفاتورة المباشرة بنفس نافذة الشحنة (قرار أحمد 2026-11-22): سطر النقل يُعرف بعلامة،
-- ورحلتها تُرسل للسائق على مرحلة التسليم مباشرة.
ALTER TABLE "sales_invoice_lines" ADD COLUMN IF NOT EXISTS "trip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "waybills" ADD COLUMN IF NOT EXISTS "deliver_only" boolean DEFAULT false NOT NULL;
