CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'cost_of_revenue', 'expense');--> statement-breakpoint
CREATE TYPE "public"."cost_center_type" AS ENUM('vehicle', 'admin', 'workshop', 'other');--> statement-breakpoint
CREATE TYPE "public"."journal_status" AS ENUM('draft', 'pending', 'posted');--> statement-breakpoint
CREATE TYPE "public"."normal_balance" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."party_kind" AS ENUM('individual', 'company');--> statement-breakpoint
CREATE TYPE "public"."party_role_type" AS ENUM('customer', 'supplier', 'carrier', 'workshop', 'fuel_station', 'customs_broker', 'sales_rep');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."permission_scope" AS ENUM('own', 'all');--> statement-breakpoint
CREATE TYPE "public"."tax_kind" AS ENUM('output', 'input', 'zero_rated', 'exempt');--> statement-breakpoint
CREATE TYPE "public"."vehicle_ownership" AS ENUM('owned', 'leased');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('active', 'maintenance', 'stopped', 'sold');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" varchar(12) NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"parent_id" bigint,
	"level" smallint NOT NULL,
	"type" "account_type" NOT NULL,
	"normal_balance" "normal_balance" NOT NULL,
	"is_postable" boolean NOT NULL,
	"requires_cost_center" boolean DEFAULT false NOT NULL,
	"currency_code" varchar(3),
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_code_unique" UNIQUE("code"),
	CONSTRAINT "accounts_level_range" CHECK ("accounts"."level" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity" varchar(60) NOT NULL,
	"entity_id" text NOT NULL,
	"action" varchar(40) NOT NULL,
	"changes" jsonb,
	"user_id" bigint,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cost_centers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" varchar(40) NOT NULL,
	"name_ar" text NOT NULL,
	"type" "cost_center_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_centers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" varchar(3) PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"decimals" smallint DEFAULT 2 NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deletion_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity" varchar(60) NOT NULL,
	"entity_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"user_id" bigint,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exchange_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"currency_code" varchar(3) NOT NULL,
	"rate_date" date NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	CONSTRAINT "exchange_rates_positive" CHECK ("exchange_rates"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fiscal_periods_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" bigint,
	CONSTRAINT "fiscal_periods_month_range" CHECK ("fiscal_periods"."month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "journal_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"entry_date" date NOT NULL,
	"description" text,
	"source_type" varchar(40),
	"source_id" bigint,
	"status" "journal_status" DEFAULT 'draft' NOT NULL,
	"fiscal_period_id" bigint,
	"created_by" bigint,
	"approved_by" bigint,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_number_unique" UNIQUE("number"),
	CONSTRAINT "journal_entries_source_pair" CHECK (("journal_entries"."source_type" is null) = ("journal_entries"."source_id" is null))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "journal_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entry_id" bigint NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" bigint NOT NULL,
	"debit" numeric(18, 3) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 3) DEFAULT '0' NOT NULL,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"debit_base" numeric(18, 3) DEFAULT '0' NOT NULL,
	"credit_base" numeric(18, 3) DEFAULT '0' NOT NULL,
	"description" text,
	"tax_code_id" bigint,
	"party_id" bigint,
	"cost_center_id" bigint,
	CONSTRAINT "journal_lines_amounts_valid" CHECK ("journal_lines"."debit" >= 0 and "journal_lines"."credit" >= 0 and ("journal_lines"."debit" = 0) <> ("journal_lines"."credit" = 0)
          and "journal_lines"."debit_base" >= 0 and "journal_lines"."credit_base" >= 0),
	CONSTRAINT "journal_lines_rate_positive" CHECK ("journal_lines"."exchange_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"doc_type" varchar(40) NOT NULL,
	"year" smallint NOT NULL,
	"prefix" varchar(10) NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "number_sequences_doc_type_year_pk" PRIMARY KEY("doc_type","year")
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parties_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" "party_kind" DEFAULT 'company' NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"vat_number" varchar(20),
	"cr_number" varchar(20),
	"national_address" text,
	"country" varchar(2) DEFAULT 'SA' NOT NULL,
	"mobile" varchar(20),
	"email" varchar(120),
	"default_currency" varchar(3) DEFAULT 'SAR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_roles" (
	"party_id" bigint NOT NULL,
	"role" "party_role_type" NOT NULL,
	CONSTRAINT "party_roles_party_id_role_pk" PRIMARY KEY("party_id","role")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" bigint NOT NULL,
	"entity" varchar(60) NOT NULL,
	"action" varchar(40) NOT NULL,
	"scope" "permission_scope" DEFAULT 'all' NOT NULL,
	CONSTRAINT "role_permissions_role_id_entity_action_pk" PRIMARY KEY("role_id","entity","action")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" varchar(40),
	"name_ar" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key"),
	CONSTRAINT "roles_name_ar_unique" UNIQUE("name_ar")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_codes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tax_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" varchar(20) NOT NULL,
	"name_ar" text NOT NULL,
	"kind" "tax_kind" NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"account_id" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "tax_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"login" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"locale" varchar(5) DEFAULT 'ar' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_login_unique" UNIQUE("login")
);
--> statement-breakpoint
CREATE TABLE "vehicle_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name_ar" text NOT NULL,
	CONSTRAINT "vehicle_types_name_ar_unique" UNIQUE("name_ar")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"plate" varchar(30) NOT NULL,
	"chassis" varchar(40) NOT NULL,
	"serial_number" varchar(40),
	"vehicle_type_id" bigint,
	"make" text,
	"model" text,
	"year" smallint,
	"color" text,
	"registration_type" text,
	"ownership" "vehicle_ownership" DEFAULT 'owned' NOT NULL,
	"ownership_date" date,
	"customs_document" text,
	"odometer" integer DEFAULT 0 NOT NULL,
	"status" "vehicle_status" DEFAULT 'active' NOT NULL,
	"cost_center_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_unique" UNIQUE("plate"),
	CONSTRAINT "vehicles_chassis_unique" UNIQUE("chassis"),
	CONSTRAINT "vehicles_cost_center_id_unique" UNIQUE("cost_center_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_log" ADD CONSTRAINT "deletion_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tax_code_id_tax_codes_id_fk" FOREIGN KEY ("tax_code_id") REFERENCES "public"."tax_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_default_currency_currencies_code_fk" FOREIGN KEY ("default_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vehicle_type_id_vehicle_types_id_fk" FOREIGN KEY ("vehicle_type_id") REFERENCES "public"."vehicle_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_parent_idx" ON "accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_currency_date_uq" ON "exchange_rates" USING btree ("currency_code","rate_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_periods_year_month_uq" ON "fiscal_periods" USING btree ("year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_source_uq" ON "journal_entries" USING btree ("source_type","source_id") WHERE "journal_entries"."source_type" is not null;--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_lines_entry_line_uq" ON "journal_lines" USING btree ("entry_id","line_no");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_cost_center_idx" ON "journal_lines" USING btree ("cost_center_id");--> statement-breakpoint
CREATE INDEX "journal_lines_party_idx" ON "journal_lines" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");