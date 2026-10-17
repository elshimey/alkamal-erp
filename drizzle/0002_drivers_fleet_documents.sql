CREATE TYPE "public"."app_language" AS ENUM('ar', 'ur', 'hi', 'en');--> statement-breakpoint
CREATE TYPE "public"."commission_class" AS ENUM('domestic', 'international');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'on_leave', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."fleet_document_type" AS ENUM('registration', 'periodic_inspection', 'operating_card', 'insurance', 'authorization', 'license', 'residency', 'other');--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drivers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"employee_id" bigint NOT NULL,
	"mobile" varchar(20),
	"nationality" text,
	"app_language" "app_language" DEFAULT 'ar' NOT NULL,
	"residency_number" varchar(20),
	"license_number" varchar(30),
	"transport_card_number" varchar(30),
	"birth_date" date,
	"commission_class" "commission_class" DEFAULT 'domestic' NOT NULL,
	"custody_account_id" bigint NOT NULL,
	"custody_limit" numeric(18, 3),
	"user_id" bigint,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_employee_id_unique" UNIQUE("employee_id"),
	CONSTRAINT "drivers_custody_account_id_unique" UNIQUE("custody_account_id"),
	CONSTRAINT "drivers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "employees_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name_ar" text NOT NULL,
	"national_id" varchar(20),
	"job_title" text,
	"hire_date" date,
	"basic_salary" numeric(18, 3) DEFAULT '0' NOT NULL,
	"allowances" numeric(18, 3) DEFAULT '0' NOT NULL,
	"bank_name" text,
	"iban" varchar(34),
	"payable_account_id" bigint,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_national_id_unique" UNIQUE("national_id"),
	CONSTRAINT "employees_payable_account_id_unique" UNIQUE("payable_account_id")
);
--> statement-breakpoint
CREATE TABLE "fleet_documents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fleet_documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vehicle_id" bigint,
	"driver_id" bigint,
	"type" "fleet_document_type" NOT NULL,
	"number" varchar(40),
	"issue_date" date,
	"expiry_date" date NOT NULL,
	"authority" text,
	"cost" numeric(18, 3),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_documents_one_owner" CHECK (("fleet_documents"."vehicle_id" is null) <> ("fleet_documents"."driver_id" is null))
);
--> statement-breakpoint
CREATE TABLE "vehicle_assignments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_assignments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vehicle_id" bigint NOT NULL,
	"driver_id" bigint NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"odometer_start" integer,
	"odometer_end" integer,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_assignments_dates" CHECK ("vehicle_assignments"."to_date" is null or "vehicle_assignments"."to_date" >= "vehicle_assignments"."from_date"),
	CONSTRAINT "vehicle_assignments_odometer" CHECK ("vehicle_assignments"."odometer_end" is null or "vehicle_assignments"."odometer_start" is null or "vehicle_assignments"."odometer_end" >= "vehicle_assignments"."odometer_start")
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN "driver_id" bigint;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_custody_account_id_accounts_id_fk" FOREIGN KEY ("custody_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_payable_account_id_accounts_id_fk" FOREIGN KEY ("payable_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_documents_expiry_idx" ON "fleet_documents" USING btree ("expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_assignments_open_vehicle_uq" ON "vehicle_assignments" USING btree ("vehicle_id") WHERE "vehicle_assignments"."to_date" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_assignments_open_driver_uq" ON "vehicle_assignments" USING btree ("driver_id") WHERE "vehicle_assignments"."to_date" is null;--> statement-breakpoint
CREATE INDEX "vehicle_assignments_vehicle_idx" ON "vehicle_assignments" USING btree ("vehicle_id","from_date");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_lines_driver_idx" ON "journal_lines" USING btree ("driver_id");