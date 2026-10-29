-- نتيجة العملية المحفوظة لكل معرّف إرسال؛ إعادة إرسال النموذج نفسه تعيدها بدل تسجيل العملية مرتين
ALTER TABLE "client_ops" ADD COLUMN IF NOT EXISTS "result" jsonb;--> statement-breakpoint
UPDATE "client_ops" SET "result" = '{}'::jsonb WHERE "result" IS NULL;
