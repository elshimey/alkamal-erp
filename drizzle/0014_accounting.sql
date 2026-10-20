CREATE TYPE "public"."asset_status" AS ENUM('active', 'disposed');--> statement-breakpoint
CREATE TABLE "asset_depreciation" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "asset_depreciation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"asset_id" bigint NOT NULL,
	"period_end" date NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"entry_id" bigint NOT NULL,
	CONSTRAINT "asset_depreciation_amount" CHECK ("asset_depreciation"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bank_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" varchar(40),
	"iban" varchar(34),
	"swift" varchar(11),
	"branch" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fixed_assets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"name_ar" text NOT NULL,
	"asset_account_id" bigint NOT NULL,
	"accumulated_account_id" bigint NOT NULL,
	"expense_account_id" bigint NOT NULL,
	"cost_center_id" bigint,
	"vehicle_id" bigint,
	"acquisition_date" date NOT NULL,
	"depreciation_start" date NOT NULL,
	"cost" numeric(18, 3) NOT NULL,
	"salvage_value" numeric(18, 3) DEFAULT '0' NOT NULL,
	"useful_life_months" integer NOT NULL,
	"opening_depreciation" numeric(18, 3) DEFAULT '0' NOT NULL,
	"acquisition_entry_id" bigint,
	"status" "asset_status" DEFAULT 'active' NOT NULL,
	"disposal_date" date,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_assets_number_unique" UNIQUE("number"),
	CONSTRAINT "fixed_assets_amounts" CHECK ("fixed_assets"."cost" > 0 and "fixed_assets"."salvage_value" >= 0 and "fixed_assets"."salvage_value" < "fixed_assets"."cost" and "fixed_assets"."useful_life_months" between 1 and 600 and "fixed_assets"."opening_depreciation" >= 0)
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "reference" varchar(60);--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_asset_account_id_accounts_id_fk" FOREIGN KEY ("asset_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accumulated_account_id_accounts_id_fk" FOREIGN KEY ("accumulated_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_expense_account_id_accounts_id_fk" FOREIGN KEY ("expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_acquisition_entry_id_journal_entries_id_fk" FOREIGN KEY ("acquisition_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_depreciation_period_uq" ON "asset_depreciation" USING btree ("asset_id","period_end");