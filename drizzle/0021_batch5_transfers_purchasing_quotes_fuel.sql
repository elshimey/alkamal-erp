CREATE TYPE "public"."fuel_statement_status" AS ENUM('open', 'reconciled');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('draft', 'approved', 'invoiced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."purchase_request_status" AS ENUM('draft', 'approved', 'rejected', 'ordered');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('draft', 'sent', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "cash_transfers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cash_transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"transfer_date" date NOT NULL,
	"from_account_id" bigint NOT NULL,
	"to_account_id" bigint NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"received_amount" numeric(18, 3) NOT NULL,
	"fee" numeric(18, 3) DEFAULT '0' NOT NULL,
	"reference" varchar(60),
	"notes" text,
	"journal_entry_id" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_transfers_number_unique" UNIQUE("number"),
	CONSTRAINT "cash_transfers_amounts" CHECK ("cash_transfers"."amount" > 0 and "cash_transfers"."received_amount" > 0 and "cash_transfers"."fee" >= 0 and "cash_transfers"."from_account_id" <> "cash_transfers"."to_account_id")
);
--> statement-breakpoint
CREATE TABLE "fuel_card_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fuel_card_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"statement_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"txn_date" date NOT NULL,
	"plate" varchar(30),
	"vehicle_id" bigint,
	"station" varchar(120),
	"reference" varchar(60),
	"liters" numeric(10, 2),
	"amount" numeric(18, 3) NOT NULL,
	"fuel_id" bigint,
	"journal_entry_id" bigint
);
--> statement-breakpoint
CREATE TABLE "fuel_card_statements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fuel_card_statements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"provider_id" bigint,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"closing_balance" numeric(18, 3),
	"status" "fuel_statement_status" DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_card_statements_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"line_no" smallint NOT NULL,
	"product_id" bigint,
	"account_id" bigint,
	"description" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '15' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"supplier_id" bigint NOT NULL,
	"request_id" bigint,
	"vehicle_id" bigint,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"status" "purchase_order_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"purchase_invoice_id" bigint,
	"created_by" bigint,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "purchase_request_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_request_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" bigint NOT NULL,
	"line_no" smallint NOT NULL,
	"product_id" bigint,
	"description" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"estimated_price" numeric(18, 3)
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"request_date" date NOT NULL,
	"needed_by" date,
	"vehicle_id" bigint,
	"status" "purchase_request_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"reject_reason" text,
	"created_by" bigint,
	"approved_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "quotation_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quotation_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"quotation_id" bigint NOT NULL,
	"line_no" smallint NOT NULL,
	"route_id" bigint,
	"description" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '15' NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"vat_amount" numeric(18, 3) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quotations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"quote_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"customer_id" bigint NOT NULL,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"status" "quotation_status" DEFAULT 'draft' NOT NULL,
	"subtotal" numeric(18, 3) DEFAULT '0' NOT NULL,
	"vat_total" numeric(18, 3) DEFAULT '0' NOT NULL,
	"total" numeric(18, 3) DEFAULT '0' NOT NULL,
	"notes" text,
	"terms" text,
	"sales_invoice_id" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_card_lines" ADD CONSTRAINT "fuel_card_lines_statement_id_fuel_card_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."fuel_card_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_card_lines" ADD CONSTRAINT "fuel_card_lines_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_card_lines" ADD CONSTRAINT "fuel_card_lines_fuel_id_waybill_fuel_id_fk" FOREIGN KEY ("fuel_id") REFERENCES "public"."waybill_fuel"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_card_lines" ADD CONSTRAINT "fuel_card_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_card_statements" ADD CONSTRAINT "fuel_card_statements_provider_id_parties_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_card_statements" ADD CONSTRAINT "fuel_card_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_request_id_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_request_id_purchase_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fuel_card_lines_statement_idx" ON "fuel_card_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fuel_card_lines_fuel_uq" ON "fuel_card_lines" USING btree ("fuel_id") WHERE "fuel_card_lines"."fuel_id" is not null;--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cash_transfers','purchase_requests','purchase_orders','quotations','fuel_card_statements']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON %I', t);
    EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t);
  END LOOP;
END $$;
