CREATE TYPE "public"."breakdown_priority" AS ENUM('low', 'normal', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."breakdown_status" AS ENUM('pending_supervisor', 'pending_approval', 'approved', 'in_progress', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."maintenance_line_kind" AS ENUM('part', 'labor');--> statement-breakpoint
CREATE TYPE "public"."maintenance_provider" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('draft', 'approved', 'completed');--> statement-breakpoint
CREATE TYPE "public"."maintenance_type" AS ENUM('consumable', 'electrical', 'body_paint', 'mechanical', 'tires', 'other');--> statement-breakpoint
CREATE TABLE "breakdown_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "breakdown_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"vehicle_id" bigint NOT NULL,
	"driver_id" bigint,
	"report_date" date NOT NULL,
	"description" text NOT NULL,
	"priority" "breakdown_priority" DEFAULT 'normal' NOT NULL,
	"estimated_cost" numeric(18, 3),
	"status" "breakdown_status" DEFAULT 'pending_supervisor' NOT NULL,
	"reject_reason" text,
	"reviewed_by" bigint,
	"approved_by" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "breakdown_requests_number_unique" UNIQUE("number"),
	CONSTRAINT "breakdown_requests_cost" CHECK ("breakdown_requests"."estimated_cost" is null or "breakdown_requests"."estimated_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "maintenance_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"line_no" smallint NOT NULL,
	"kind" "maintenance_line_kind" NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit_price" numeric(18, 3) NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	CONSTRAINT "maintenance_lines_amounts" CHECK ("maintenance_lines"."quantity" > 0 and "maintenance_lines"."unit_price" >= 0 and "maintenance_lines"."amount" >= 0 and "maintenance_lines"."vat_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "maintenance_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"vehicle_id" bigint NOT NULL,
	"order_date" date NOT NULL,
	"type" "maintenance_type" NOT NULL,
	"provider" "maintenance_provider" NOT NULL,
	"supplier_id" bigint,
	"supplier_invoice_no" varchar(60),
	"cash_account_id" bigint,
	"odometer" integer,
	"breakdown_request_id" bigint,
	"plan_id" bigint,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"subtotal" numeric(18, 3) DEFAULT '0' NOT NULL,
	"vat_total" numeric(18, 3) DEFAULT '0' NOT NULL,
	"total" numeric(18, 3) DEFAULT '0' NOT NULL,
	"status" "maintenance_status" DEFAULT 'draft' NOT NULL,
	"completed_date" date,
	"notes" text,
	"journal_entry_id" bigint,
	"approved_by" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_orders_number_unique" UNIQUE("number"),
	CONSTRAINT "maintenance_orders_provider_refs" CHECK (case "maintenance_orders"."provider" when 'external' then "maintenance_orders"."supplier_id" is not null when 'internal' then "maintenance_orders"."supplier_id" is null end),
	CONSTRAINT "maintenance_orders_completed" CHECK ("maintenance_orders"."completed_date" is null or "maintenance_orders"."completed_date" >= "maintenance_orders"."order_date")
);
--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "maintenance_plans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vehicle_id" bigint NOT NULL,
	"type" "maintenance_type" NOT NULL,
	"title" text NOT NULL,
	"interval_days" integer NOT NULL,
	"last_done_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_plans_interval" CHECK ("maintenance_plans"."interval_days" between 1 and 3650)
);
--> statement-breakpoint
ALTER TABLE "breakdown_requests" ADD CONSTRAINT "breakdown_requests_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_requests" ADD CONSTRAINT "breakdown_requests_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_requests" ADD CONSTRAINT "breakdown_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_requests" ADD CONSTRAINT "breakdown_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_requests" ADD CONSTRAINT "breakdown_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_lines" ADD CONSTRAINT "maintenance_lines_order_id_maintenance_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."maintenance_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_supplier_id_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_breakdown_request_id_breakdown_requests_id_fk" FOREIGN KEY ("breakdown_request_id") REFERENCES "public"."breakdown_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_plan_id_maintenance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "breakdown_requests_status_idx" ON "breakdown_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "maintenance_lines_order_idx" ON "maintenance_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "maintenance_orders_vehicle_idx" ON "maintenance_orders" USING btree ("vehicle_id","order_date");--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_orders_request_uq" ON "maintenance_orders" USING btree ("breakdown_request_id") WHERE "maintenance_orders"."breakdown_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_orders_supplier_no_uq" ON "maintenance_orders" USING btree ("supplier_id","supplier_invoice_no") WHERE "maintenance_orders"."supplier_invoice_no" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_plans_vehicle_title_uq" ON "maintenance_plans" USING btree ("vehicle_id","title");