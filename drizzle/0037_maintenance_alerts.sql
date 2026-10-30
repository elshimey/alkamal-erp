CREATE TABLE IF NOT EXISTS "user_alert_reads" (
	"user_id" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"key" varchar(60) NOT NULL,
	"sig" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("user_id", "key")
);--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD COLUMN IF NOT EXISTS "type_class_id" bigint REFERENCES "lookup_values"("id");--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD COLUMN IF NOT EXISTS "type_class_id" bigint REFERENCES "lookup_values"("id");--> statement-breakpoint
ALTER TABLE "maintenance_orders" DROP CONSTRAINT IF EXISTS "maintenance_orders_provider_refs";--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_provider_refs" CHECK ("provider" = 'internal' or "supplier_id" is not null);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "maintenance_order_id" bigint REFERENCES "maintenance_orders"("id");
