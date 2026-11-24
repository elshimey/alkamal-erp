-- محضر استلام وتسليم المركبة (طلب أحمد 2026-11-24): مستند عهدة يُطبع ويوقّعه السائق،
-- بنوعه (استلام من الشركة، تسليم للشركة، تسليم لسائق آخر) ومعه العدد والأدوات.
CREATE TABLE IF NOT EXISTS "vehicle_handovers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"number" varchar(30) NOT NULL UNIQUE,
	"kind" varchar(10) NOT NULL,
	"vehicle_id" bigint NOT NULL REFERENCES "vehicles"("id"),
	"from_driver_id" bigint REFERENCES "drivers"("id"),
	"to_driver_id" bigint REFERENCES "drivers"("id"),
	"handover_date" date NOT NULL,
	"odometer" integer,
	"fuel_level" varchar(12),
	"condition" varchar(10),
	"company_rep" text,
	"notes" text,
	"assignment_id" bigint REFERENCES "vehicle_assignments"("id") ON DELETE SET NULL,
	"closed_assignment_id" bigint REFERENCES "vehicle_assignments"("id") ON DELETE SET NULL,
	"created_by" bigint REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_handovers_kind" CHECK ("kind" in ('receive', 'return', 'transfer'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_handovers_vehicle_idx" ON "vehicle_handovers" ("vehicle_id", "handover_date");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_handover_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"handover_id" bigint NOT NULL REFERENCES "vehicle_handovers"("id") ON DELETE cascade,
	"line_no" integer NOT NULL,
	"name" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"condition" text,
	CONSTRAINT "vehicle_handover_items_qty" CHECK ("qty" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_handover_items_doc_idx" ON "vehicle_handover_items" ("handover_id");
