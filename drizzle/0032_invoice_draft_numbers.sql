-- رقم المسودة: الفاتورة تأخذ رقماً من سلسلة المسودات، والرقم الرسمي عند أول إصدار فقط
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "draft_number" varchar(30);--> statement-breakpoint
UPDATE "sales_invoices" SET "draft_number" = "number" WHERE "status" = 'draft' AND "draft_number" IS NULL;--> statement-breakpoint
-- أصل البند الحر بعد دمج الفواتير، ليُفك الدمج إلى فواتيره الأصلية
ALTER TABLE "sales_invoice_lines" ADD COLUMN IF NOT EXISTS "group_key" integer;
