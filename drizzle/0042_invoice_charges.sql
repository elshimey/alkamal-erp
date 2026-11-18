-- مصاريف على العميل في الفاتورة المباشرة (دون شحنة): المصروف مربوط بالفاتورة نفسها
ALTER TABLE "waybill_expenses" ALTER COLUMN "waybill_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "waybill_expenses" ADD COLUMN IF NOT EXISTS "invoice_id" bigint REFERENCES "sales_invoices"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waybill_expenses_invoice_idx" ON "waybill_expenses" ("invoice_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "waybill_expenses" ADD CONSTRAINT "waybill_expenses_home" CHECK (("waybill_id" is null) <> ("invoice_id" is null));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
