ALTER TYPE "quotation_status" ADD VALUE IF NOT EXISTS 'cancelled';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "shipping_type" varchar(15) DEFAULT 'international' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "reference" text;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_shipping_type_chk" CHECK ("shipping_type" in ('international', 'domestic'));--> statement-breakpoint
UPDATE "quotations" q SET "shipping_type" = 'domestic' WHERE EXISTS (SELECT 1 FROM "quotation_lines" l WHERE l.quotation_id = q.id AND l.vat_rate > 0);
