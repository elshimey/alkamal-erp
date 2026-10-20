CREATE TYPE "public"."note_kind" AS ENUM('sales_credit', 'sales_debit', 'purchase_debit', 'purchase_credit');--> statement-breakpoint
CREATE TYPE "public"."receipt_kind" AS ENUM('invoice_payment', 'advance', 'refund');--> statement-breakpoint
CREATE TABLE "adjustment_note_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "adjustment_note_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"note_id" bigint NOT NULL,
	"line_no" smallint NOT NULL,
	"description" text NOT NULL,
	"account_id" bigint NOT NULL,
	"cost_center_id" bigint,
	"amount" numeric(18, 3) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	CONSTRAINT "adjustment_note_lines_amounts" CHECK ("adjustment_note_lines"."amount" > 0 and "adjustment_note_lines"."vat_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "adjustment_notes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "adjustment_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"kind" "note_kind" NOT NULL,
	"note_date" date NOT NULL,
	"party_id" bigint NOT NULL,
	"sales_invoice_id" bigint,
	"purchase_invoice_id" bigint,
	"payable_account_id" bigint,
	"currency_code" varchar(3) DEFAULT 'SAR' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"reason" text NOT NULL,
	"subtotal" numeric(18, 3) DEFAULT '0' NOT NULL,
	"vat_total" numeric(18, 3) DEFAULT '0' NOT NULL,
	"total" numeric(18, 3) DEFAULT '0' NOT NULL,
	"applied_amount" numeric(18, 3) DEFAULT '0' NOT NULL,
	"status" "purchase_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustment_notes_number_unique" UNIQUE("number"),
	CONSTRAINT "adjustment_notes_invoice" CHECK (("adjustment_notes"."kind" in ('sales_credit', 'sales_debit') and "adjustment_notes"."purchase_invoice_id" is null) or ("adjustment_notes"."kind" in ('purchase_debit', 'purchase_credit') and "adjustment_notes"."sales_invoice_id" is null and "adjustment_notes"."payable_account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "receipt_adjustments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipt_adjustments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"amount" numeric(18, 3) NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "receipt_adjustments_positive" CHECK ("receipt_adjustments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD COLUMN "entry_id" bigint;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "kind" "receipt_kind" DEFAULT 'invoice_payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "adjustment_note_lines" ADD CONSTRAINT "adjustment_note_lines_note_id_adjustment_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."adjustment_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_note_lines" ADD CONSTRAINT "adjustment_note_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_note_lines" ADD CONSTRAINT "adjustment_note_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_notes" ADD CONSTRAINT "adjustment_notes_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_notes" ADD CONSTRAINT "adjustment_notes_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_notes" ADD CONSTRAINT "adjustment_notes_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_notes" ADD CONSTRAINT "adjustment_notes_payable_account_id_accounts_id_fk" FOREIGN KEY ("payable_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_notes" ADD CONSTRAINT "adjustment_notes_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_notes" ADD CONSTRAINT "adjustment_notes_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_notes" ADD CONSTRAINT "adjustment_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_adjustments" ADD CONSTRAINT "receipt_adjustments_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_adjustments" ADD CONSTRAINT "receipt_adjustments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustment_note_lines_note_idx" ON "adjustment_note_lines" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "adjustment_notes_party_idx" ON "adjustment_notes" USING btree ("party_id","kind");--> statement-breakpoint
CREATE INDEX "receipt_adjustments_receipt_idx" ON "receipt_adjustments" USING btree ("receipt_id");--> statement-breakpoint
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;