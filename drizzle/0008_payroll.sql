CREATE TYPE "public"."advance_status" AS ENUM('pending', 'paid', 'settled');--> statement-breakpoint
CREATE TYPE "public"."payroll_status" AS ENUM('draft', 'approved', 'paid');--> statement-breakpoint
CREATE TABLE "employee_advances" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "employee_advances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"employee_id" bigint NOT NULL,
	"advance_date" date NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"installment" numeric(18, 3) NOT NULL,
	"repaid_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"cash_account_id" bigint,
	"status" "advance_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"journal_entry_id" bigint,
	"created_by" bigint,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_advances_number_unique" UNIQUE("number"),
	CONSTRAINT "employee_advances_amounts" CHECK ("employee_advances"."amount" > 0 and "employee_advances"."installment" > 0 and "employee_advances"."installment" <= "employee_advances"."amount" and "employee_advances"."repaid_amount" between 0 and "employee_advances"."amount")
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payroll_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" bigint NOT NULL,
	"employee_id" bigint NOT NULL,
	"driver_id" bigint,
	"cost_center_id" bigint,
	"basic" numeric(18, 3) DEFAULT '0' NOT NULL,
	"housing" numeric(18, 3) DEFAULT '0' NOT NULL,
	"other_allowances" numeric(18, 3) DEFAULT '0' NOT NULL,
	"absence_days" numeric(5, 2) DEFAULT '0' NOT NULL,
	"absence_deduction" numeric(18, 3) DEFAULT '0' NOT NULL,
	"additions" numeric(18, 3) DEFAULT '0' NOT NULL,
	"deductions" numeric(18, 3) DEFAULT '0' NOT NULL,
	"commissions" numeric(18, 3) DEFAULT '0' NOT NULL,
	"advance_deduction" numeric(18, 3) DEFAULT '0' NOT NULL,
	"gosi_employee" numeric(18, 3) DEFAULT '0' NOT NULL,
	"gosi_employer" numeric(18, 3) DEFAULT '0' NOT NULL,
	"eosb_accrual" numeric(18, 3) DEFAULT '0' NOT NULL,
	"net" numeric(18, 3) DEFAULT '0' NOT NULL,
	"notes" text,
	CONSTRAINT "payroll_lines_amounts" CHECK ("payroll_lines"."basic" >= 0 and "payroll_lines"."housing" >= 0 and "payroll_lines"."other_allowances" >= 0 and "payroll_lines"."absence_days" >= 0 and "payroll_lines"."additions" >= 0 and "payroll_lines"."deductions" >= 0 and "payroll_lines"."advance_deduction" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payroll_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"month" date NOT NULL,
	"status" "payroll_status" DEFAULT 'draft' NOT NULL,
	"payment_date" date,
	"bank_account_id" bigint,
	"journal_entry_id" bigint,
	"payment_entry_id" bigint,
	"notes" text,
	"created_by" bigint,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_number_unique" UNIQUE("number"),
	CONSTRAINT "payroll_runs_month_unique" UNIQUE("month"),
	CONSTRAINT "payroll_runs_month_start" CHECK (extract(day from "payroll_runs"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "housing_allowance" numeric(18, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "is_saudi" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "gosi_subject" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_advances" ADD CONSTRAINT "employee_advances_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_bank_account_id_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payment_entry_id_journal_entries_id_fk" FOREIGN KEY ("payment_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_advances_employee_idx" ON "employee_advances" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lines_run_employee_uq" ON "payroll_lines" USING btree ("run_id","employee_id");