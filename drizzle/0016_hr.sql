CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'leave');--> statement-breakpoint
CREATE TYPE "public"."commission_advance_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."custody_kind" AS ENUM('cash', 'in_kind');--> statement-breakpoint
CREATE TYPE "public"."custody_status" AS ENUM('draft', 'approved', 'delivered', 'settled', 'returned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."evaluation_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."hr_action_kind" AS ENUM('warning', 'penalty', 'incentive');--> statement-breakpoint
CREATE TYPE "public"."hr_action_status" AS ENUM('draft', 'approved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "attendance_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"employee_id" bigint NOT NULL,
	"day" date NOT NULL,
	"status" "attendance_status" NOT NULL,
	"late_minutes" smallint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_late" CHECK ("attendance"."late_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commission_advance_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commission_advance_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"driver_id" bigint NOT NULL,
	"request_date" date NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"notes" text,
	"status" "commission_advance_status" DEFAULT 'pending' NOT NULL,
	"advance_id" bigint,
	"reject_reason" text,
	"decided_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_advance_requests_number_unique" UNIQUE("number"),
	CONSTRAINT "commission_advance_amount" CHECK ("commission_advance_requests"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "custody_docs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custody_docs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"kind" "custody_kind" NOT NULL,
	"employee_id" bigint NOT NULL,
	"doc_date" date NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"serial_no" varchar(60),
	"is_opening" boolean DEFAULT false NOT NULL,
	"status" "custody_status" DEFAULT 'draft' NOT NULL,
	"cash_account_id" bigint,
	"journal_entry_id" bigint,
	"close_date" date,
	"returned_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"close_entry_id" bigint,
	"close_notes" text,
	"notes" text,
	"created_by" bigint,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custody_docs_number_unique" UNIQUE("number"),
	CONSTRAINT "custody_docs_amounts" CHECK ("custody_docs"."amount" >= 0 and "custody_docs"."quantity" > 0 and "custody_docs"."returned_amount" between 0 and "custody_docs"."amount" and ("custody_docs"."kind" <> 'cash' or "custody_docs"."amount" > 0))
);
--> statement-breakpoint
CREATE TABLE "evaluation_criteria" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evaluation_criteria_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name_ar" text NOT NULL,
	"weight" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "evaluation_criteria_weight" CHECK ("evaluation_criteria"."weight" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evaluations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"employee_id" bigint NOT NULL,
	"month" date NOT NULL,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"base_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"warnings" smallint DEFAULT 0 NOT NULL,
	"violations" smallint DEFAULT 0 NOT NULL,
	"deduction" numeric(5, 2) DEFAULT '0' NOT NULL,
	"final_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"status" "evaluation_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" bigint,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_month_start" CHECK (extract(day from "evaluations"."month") = 1)
);
--> statement-breakpoint
CREATE TABLE "hr_actions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hr_actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"kind" "hr_action_kind" NOT NULL,
	"employee_id" bigint NOT NULL,
	"action_date" date NOT NULL,
	"amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"points" smallint DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"status" "hr_action_status" DEFAULT 'draft' NOT NULL,
	"payroll_run_id" bigint,
	"created_by" bigint,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_actions_number_unique" UNIQUE("number"),
	CONSTRAINT "hr_actions_values" CHECK ("hr_actions"."points" >= 0 and ("hr_actions"."kind" = 'warning' or "hr_actions"."amount" > 0))
);
--> statement-breakpoint
CREATE TABLE "hr_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"warning_points" smallint DEFAULT 2 NOT NULL,
	"violations_as_warnings" boolean DEFAULT true NOT NULL,
	"promotion_score" smallint DEFAULT 85 NOT NULL,
	"promotion_months" smallint DEFAULT 3 NOT NULL,
	"advance_open_day" smallint DEFAULT 1 NOT NULL,
	"advance_close_day" smallint DEFAULT 20 NOT NULL,
	"advance_cap_domestic" numeric(18, 3) DEFAULT '1000' NOT NULL,
	"advance_cap_international" numeric(18, 3) DEFAULT '2000' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_settings_singleton" CHECK ("hr_settings"."id" = 1),
	CONSTRAINT "hr_settings_days" CHECK ("hr_settings"."advance_open_day" between 1 and 31 and "hr_settings"."advance_close_day" between "hr_settings"."advance_open_day" and 31)
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leave_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"employee_id" bigint NOT NULL,
	"type_id" bigint NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"days" smallint NOT NULL,
	"reason" text,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"created_by" bigint,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_number_unique" UNIQUE("number"),
	CONSTRAINT "leave_requests_dates" CHECK ("leave_requests"."to_date" >= "leave_requests"."from_date" and "leave_requests"."days" > 0)
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leave_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name_ar" text NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"is_annual" boolean DEFAULT false NOT NULL,
	"yearly_days" smallint,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "leave_types_name_ar_unique" UNIQUE("name_ar")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "promotions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"employee_id" bigint NOT NULL,
	"effective_date" date NOT NULL,
	"from_title" text,
	"to_title" text,
	"from_basic" numeric(18, 3) NOT NULL,
	"to_basic" numeric(18, 3) NOT NULL,
	"reason" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "custody_account_id" bigint;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "incentives" numeric(18, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "penalties" numeric(18, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD COLUMN "leave_days" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_advance_requests" ADD CONSTRAINT "commission_advance_requests_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_advance_requests" ADD CONSTRAINT "commission_advance_requests_advance_id_employee_advances_id_fk" FOREIGN KEY ("advance_id") REFERENCES "public"."employee_advances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_advance_requests" ADD CONSTRAINT "commission_advance_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_docs" ADD CONSTRAINT "custody_docs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_docs" ADD CONSTRAINT "custody_docs_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_docs" ADD CONSTRAINT "custody_docs_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_docs" ADD CONSTRAINT "custody_docs_close_entry_id_journal_entries_id_fk" FOREIGN KEY ("close_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_docs" ADD CONSTRAINT "custody_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_docs" ADD CONSTRAINT "custody_docs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_actions" ADD CONSTRAINT "hr_actions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_actions" ADD CONSTRAINT "hr_actions_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_actions" ADD CONSTRAINT "hr_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_actions" ADD CONSTRAINT "hr_actions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_type_id_leave_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_employee_day_uq" ON "attendance" USING btree ("employee_id","day");--> statement-breakpoint
CREATE INDEX "commission_advance_driver_idx" ON "commission_advance_requests" USING btree ("driver_id","request_date");--> statement-breakpoint
CREATE INDEX "custody_docs_employee_idx" ON "custody_docs" USING btree ("employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_employee_month_uq" ON "evaluations" USING btree ("employee_id","month");--> statement-breakpoint
CREATE INDEX "hr_actions_employee_idx" ON "hr_actions" USING btree ("employee_id","action_date");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id","from_date");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_custody_account_id_accounts_id_fk" FOREIGN KEY ("custody_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_custody_account_id_unique" UNIQUE("custody_account_id");--> statement-breakpoint
INSERT INTO "hr_settings" ("id") VALUES (1);--> statement-breakpoint
INSERT INTO "evaluation_criteria" ("name_ar", "weight", "sort_order") VALUES ('سلامة القيادة والالتزام بأنظمة المرور', 10, 1), ('الانضباط والالتزام بالمواعيد', 8, 2), ('المحافظة على المركبة والعهدة', 7, 3), ('التعامل مع العملاء والزملاء', 6, 4), ('الالتزام بالتعليمات والإجراءات', 6, 5);--> statement-breakpoint
INSERT INTO "leave_types" ("name_ar", "paid", "is_annual", "yearly_days") VALUES ('إجازة سنوية', true, true, NULL), ('إجازة مرضية', true, false, 30), ('إجازة اضطرارية', true, false, 5), ('إجازة بدون راتب', false, false, NULL);
