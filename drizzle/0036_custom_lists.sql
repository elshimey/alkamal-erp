CREATE TABLE IF NOT EXISTS "lookup_values" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"list" varchar(30) NOT NULL,
	"label" text NOT NULL,
	"base" varchar(30),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lookup_values_list_label_uq" ON "lookup_values" ("list", "label");--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "asset_class_id" bigint REFERENCES "lookup_values"("id");--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "status_class_id" bigint REFERENCES "lookup_values"("id");--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "ownership_class_id" bigint REFERENCES "lookup_values"("id");--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "plate_type_class_id" bigint REFERENCES "lookup_values"("id");--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "chassis" DROP NOT NULL;--> statement-breakpoint
ALTER TYPE "document_owner_kind" ADD VALUE IF NOT EXISTS 'supplier';
