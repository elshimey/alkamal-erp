ALTER TYPE "expense_status" ADD VALUE IF NOT EXISTS 'voided';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"name_ar" text NOT NULL,
	"name_en" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "maintenance_types" ("name_ar", "name_en", "sort_order") VALUES
('تغيير زيت وفلاتر', 'Oil and filters', 1),
('إطارات', 'Tires', 2),
('فرامل', 'Brakes', 3),
('بطارية', 'Battery', 4),
('كهرباء', 'Electrical', 5),
('تكييف', 'Air conditioning', 6),
('محرك', 'Engine', 7),
('قير وناقل حركة', 'Gearbox', 8),
('تعليق ومقصات', 'Suspension', 9),
('تشحيم وغسيل', 'Greasing and washing', 10),
('سطحة أو مقطورة', 'Trailer', 11),
('أخرى', 'Other', 99);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "driver_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "reported_payer" varchar(10);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "maintenance_type_id" bigint REFERENCES "maintenance_types"("id");--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "void_reason" text;--> statement-breakpoint
ALTER TABLE "breakdown_requests" ADD COLUMN IF NOT EXISTS "maintenance_type_id" bigint REFERENCES "maintenance_types"("id");--> statement-breakpoint
ALTER TABLE "commission_advance_requests" ADD COLUMN IF NOT EXISTS "source" varchar(10) DEFAULT 'cash' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"driver_id" bigint NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
	"kind" varchar(30) NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_notifications_driver_idx" ON "driver_notifications" ("driver_id", "created_at");
