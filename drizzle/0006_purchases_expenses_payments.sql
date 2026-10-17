CREATE TYPE "public"."direct_expense_payer" AS ENUM('driver_custody', 'cash');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('supplier', 'custody');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('draft', 'posted');--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expenses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"expense_date" date NOT NULL,
	"payer" "direct_expense_payer" NOT NULL,
	"driver_id" bigint,
	"cash_account_id" bigint,
	"account_id" bigint NOT NULL,
	"vehicle_id" bigint,
	"cost_center_id" bigint,
	"waybill_id" bigint,
	"description" text NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"vat_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"vendor_name" text,
	"reference" varchar(60),
	"status" "expense_status" DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"journal_entry_id" bigint,
	"approved_by" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_number_unique" UNIQUE("number"),
	CONSTRAINT "expenses_amounts" CHECK ("expenses"."amount" > 0 and "expenses"."vat_amount" >= 0 and "expenses"."exchange_rate" > 0),
	CONSTRAINT "expenses_payer_refs" CHECK (case "expenses"."payer" when 'driver_custody' then "expenses"."driver_id" is not null when 'cash' then "expenses"."cash_account_id" is not null end)
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"payment_id" bigint NOT NULL,
	"invoice_id" bigint NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	CONSTRAINT "payment_allocations_payment_id_invoice_id_pk" PRIMARY KEY("payment_id","invoice_id"),
	CONSTRAINT "payment_allocations_positive" CHECK ("payment_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"payment_date" date NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"party_id" bigint,
	"driver_id" bigint,
	"debit_account_id" bigint NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"method" "payment_method" NOT NULL,
	"cash_account_id" bigint NOT NULL,
	"reference" varchar(60),
	"notes" text,
	"status" "receipt_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_number_unique" UNIQUE("number"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0 and "payments"."exchange_rate" > 0),
	CONSTRAINT "payments_kind_refs" CHECK (case "payments"."kind" when 'supplier' then "payments"."party_id" is not null when 'custody' then "payments"."driver_id" is not null end)
);
--> statement-breakpoint
CREATE TABLE "purchase_invoice_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_invoice_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"invoice_id" bigint NOT NULL,
	"line_no" smallint NOT NULL,
	"account_id" bigint NOT NULL,
	"cost_center_id" bigint,
	"description" text NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"tax_code_id" bigint,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	CONSTRAINT "purchase_invoice_lines_amounts" CHECK ("purchase_invoice_lines"."amount" > 0 and "purchase_invoice_lines"."vat_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"supplier_id" bigint NOT NULL,
	"supplier_invoice_no" varchar(60) NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"payable_account_id" bigint NOT NULL,
	"subtotal" numeric(18, 3) DEFAULT '0' NOT NULL,
	"vat_total" numeric(18, 3) DEFAULT '0' NOT NULL,
	"total" numeric(18, 3) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"status" "purchase_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"journal_entry_id" bigint,
	"posted_by" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "purchase_invoices_dates" CHECK ("purchase_invoices"."due_date" >= "purchase_invoices"."invoice_date"),
	CONSTRAINT "purchase_invoices_paid" CHECK ("purchase_invoices"."paid_amount" >= 0 and "purchase_invoices"."paid_amount" <= "purchase_invoices"."total")
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_waybill_id_waybills_id_fk" FOREIGN KEY ("waybill_id") REFERENCES "public"."waybills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_debit_account_id_accounts_id_fk" FOREIGN KEY ("debit_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_tax_code_id_tax_codes_id_fk" FOREIGN KEY ("tax_code_id") REFERENCES "public"."tax_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_payable_account_id_accounts_id_fk" FOREIGN KEY ("payable_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "expenses" USING btree ("status","expense_date");--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_party_idx" ON "payments" USING btree ("party_id","payment_date");--> statement-breakpoint
CREATE INDEX "purchase_invoice_lines_invoice_idx" ON "purchase_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_supplier_no_uq" ON "purchase_invoices" USING btree ("supplier_id","supplier_invoice_no");--> statement-breakpoint
CREATE INDEX "purchase_invoices_supplier_idx" ON "purchase_invoices" USING btree ("supplier_id","status");