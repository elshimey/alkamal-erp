CREATE TYPE "public"."reconciliation_status" AS ENUM('draft', 'completed');--> statement-breakpoint
CREATE TABLE "bank_reconciliation_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bank_reconciliation_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"reconciliation_id" bigint NOT NULL,
	"journal_line_id" bigint NOT NULL,
	CONSTRAINT "bank_reconciliation_items_journal_line_id_unique" UNIQUE("journal_line_id")
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bank_reconciliations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"account_id" bigint NOT NULL,
	"statement_date" date NOT NULL,
	"statement_balance" numeric(18, 3) NOT NULL,
	"status" "reconciliation_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_by" bigint,
	"completed_at" timestamp with time zone,
	CONSTRAINT "bank_reconciliations_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "bank_reconciliation_items" ADD CONSTRAINT "bank_reconciliation_items_reconciliation_id_bank_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."bank_reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_items" ADD CONSTRAINT "bank_reconciliation_items_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_reconciliations_account_idx" ON "bank_reconciliations" USING btree ("account_id","statement_date");