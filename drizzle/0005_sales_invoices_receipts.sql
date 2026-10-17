CREATE TYPE "public"."invoice_line_kind" AS ENUM('waybill', 'expense');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'transfer', 'cheque', 'card');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('draft', 'posted');--> statement-breakpoint
CREATE TYPE "public"."zatca_status" AS ENUM('not_sent', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "receipt_allocations" (
	"receipt_id" bigint NOT NULL,
	"invoice_id" bigint NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	CONSTRAINT "receipt_allocations_receipt_id_invoice_id_pk" PRIMARY KEY("receipt_id","invoice_id"),
	CONSTRAINT "receipt_allocations_positive" CHECK ("receipt_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"receipt_date" date NOT NULL,
	"customer_id" bigint NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"method" "payment_method" NOT NULL,
	"cash_account_id" bigint NOT NULL,
	"collector" text,
	"reference" varchar(60),
	"notes" text,
	"status" "receipt_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_number_unique" UNIQUE("number"),
	CONSTRAINT "receipts_amount_positive" CHECK ("receipts"."amount" > 0 and "receipts"."exchange_rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_invoice_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"invoice_id" bigint NOT NULL,
	"line_no" smallint NOT NULL,
	"kind" "invoice_line_kind" NOT NULL,
	"waybill_id" bigint,
	"waybill_expense_id" bigint,
	"description" text NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"tax_code_id" bigint,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"account_id" bigint NOT NULL,
	"cost_center_id" bigint,
	CONSTRAINT "sales_invoice_lines_refs" CHECK (case "sales_invoice_lines"."kind"
        when 'waybill' then "sales_invoice_lines"."waybill_id" is not null and "sales_invoice_lines"."waybill_expense_id" is null
        when 'expense' then "sales_invoice_lines"."waybill_expense_id" is not null
      end),
	CONSTRAINT "sales_invoice_lines_amounts" CHECK ("sales_invoice_lines"."amount" >= 0 and "sales_invoice_lines"."vat_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"customer_id" bigint NOT NULL,
	"contract_id" bigint,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"subtotal" numeric(18, 3) DEFAULT '0' NOT NULL,
	"vat_total" numeric(18, 3) DEFAULT '0' NOT NULL,
	"total" numeric(18, 3) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"zatca_status" "zatca_status" DEFAULT 'not_sent' NOT NULL,
	"zatca_response" text,
	"notes" text,
	"journal_entry_id" bigint,
	"issued_by" bigint,
	"issued_at" timestamp with time zone,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "sales_invoices_dates" CHECK ("sales_invoices"."due_date" >= "sales_invoices"."invoice_date"),
	CONSTRAINT "sales_invoices_paid" CHECK ("sales_invoices"."paid_amount" >= 0 and "sales_invoices"."paid_amount" <= "sales_invoices"."total")
);
--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_waybill_id_waybills_id_fk" FOREIGN KEY ("waybill_id") REFERENCES "public"."waybills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_waybill_expense_id_waybill_expenses_id_fk" FOREIGN KEY ("waybill_expense_id") REFERENCES "public"."waybill_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_tax_code_id_tax_codes_id_fk" FOREIGN KEY ("tax_code_id") REFERENCES "public"."tax_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_parties_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_allocations_invoice_idx" ON "receipt_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "receipts_customer_idx" ON "receipts" USING btree ("customer_id","receipt_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_lines_waybill_uq" ON "sales_invoice_lines" USING btree ("waybill_id") WHERE "sales_invoice_lines"."kind" = 'waybill';--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_lines_expense_uq" ON "sales_invoice_lines" USING btree ("waybill_expense_id") WHERE "sales_invoice_lines"."waybill_expense_id" is not null;--> statement-breakpoint
CREATE INDEX "sales_invoice_lines_invoice_idx" ON "sales_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_invoices_customer_idx" ON "sales_invoices" USING btree ("customer_id","status");