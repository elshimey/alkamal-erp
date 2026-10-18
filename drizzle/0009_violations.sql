CREATE TYPE "public"."violation_charge_to" AS ENUM('driver', 'company');--> statement-breakpoint
CREATE TYPE "public"."violation_status" AS ENUM('posted', 'paid');--> statement-breakpoint
CREATE TABLE "traffic_violations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "traffic_violations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"violation_date" date NOT NULL,
	"reference" varchar(40),
	"vehicle_id" bigint NOT NULL,
	"driver_id" bigint,
	"violation_type" text NOT NULL,
	"location" text,
	"amount" numeric(18, 3) NOT NULL,
	"charge_to" "violation_charge_to" NOT NULL,
	"status" "violation_status" DEFAULT 'posted' NOT NULL,
	"journal_entry_id" bigint,
	"payroll_run_id" bigint,
	"payment_date" date,
	"cash_account_id" bigint,
	"payment_entry_id" bigint,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traffic_violations_number_unique" UNIQUE("number"),
	CONSTRAINT "traffic_violations_reference_unique" UNIQUE("reference"),
	CONSTRAINT "traffic_violations_amount" CHECK ("traffic_violations"."amount" > 0),
	CONSTRAINT "traffic_violations_driver" CHECK ("traffic_violations"."charge_to" <> 'driver' or "traffic_violations"."driver_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "violations" numeric(18, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "traffic_violations" ADD CONSTRAINT "traffic_violations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_violations" ADD CONSTRAINT "traffic_violations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_violations" ADD CONSTRAINT "traffic_violations_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_violations" ADD CONSTRAINT "traffic_violations_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_violations" ADD CONSTRAINT "traffic_violations_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_violations" ADD CONSTRAINT "traffic_violations_payment_entry_id_journal_entries_id_fk" FOREIGN KEY ("payment_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_violations" ADD CONSTRAINT "traffic_violations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "traffic_violations_vehicle_idx" ON "traffic_violations" USING btree ("vehicle_id","violation_date");--> statement-breakpoint
CREATE INDEX "traffic_violations_driver_idx" ON "traffic_violations" USING btree ("driver_id","violation_date");