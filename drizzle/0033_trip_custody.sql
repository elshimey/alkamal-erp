ALTER TABLE "waybills" ADD COLUMN IF NOT EXISTS "trip_custody" numeric(18, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "waybills" ADD COLUMN IF NOT EXISTS "custody_payment_id" bigint REFERENCES "payments"("id");--> statement-breakpoint
ALTER TABLE "waybills" ADD COLUMN IF NOT EXISTS "source_invoice_id" bigint REFERENCES "sales_invoices"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waybills_source_invoice_idx" ON "waybills" ("source_invoice_id");--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_trip_custody" CHECK ("trip_custody" >= 0);
