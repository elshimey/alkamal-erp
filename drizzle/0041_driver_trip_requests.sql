DO $$ BEGIN
	CREATE TYPE "trip_request_status" AS ENUM ('pending', 'converted', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_trip_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"driver_id" bigint NOT NULL REFERENCES "drivers"("id"),
	"vehicle_id" bigint NOT NULL REFERENCES "vehicles"("id"),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"status" "trip_request_status" DEFAULT 'pending' NOT NULL,
	"waybill_id" bigint REFERENCES "waybills"("id") ON DELETE SET NULL,
	"rejection_reason" text,
	"decided_by" bigint REFERENCES "users"("id") ON DELETE SET NULL,
	"decided_at" timestamp with time zone,
	"created_by" bigint REFERENCES "users"("id") ON DELETE SET NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_trip_requests_status_idx" ON "driver_trip_requests" ("status", "requested_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_trip_requests_driver_idx" ON "driver_trip_requests" ("driver_id", "requested_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_trip_request_stages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"request_id" bigint NOT NULL REFERENCES "driver_trip_requests"("id") ON DELETE CASCADE,
	"stage" "trip_stage_type" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"odometer" integer,
	"created_by" bigint REFERENCES "users"("id") ON DELETE SET NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_trip_request_stages_idx" ON "driver_trip_request_stages" ("request_id", "at");
