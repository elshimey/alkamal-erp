ALTER TYPE "public"."invoice_line_kind" ADD VALUE 'manual';--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT "sales_invoice_lines_refs";--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "quantity" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "unit_price" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "discount_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "reference" varchar(60);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "asset_account_id" bigint;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_asset_account_id_accounts_id_fk" FOREIGN KEY ("asset_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_reference_unique" UNIQUE("reference");--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_refs" CHECK (case "sales_invoice_lines"."kind"
        when 'waybill' then "sales_invoice_lines"."waybill_id" is not null and "sales_invoice_lines"."waybill_expense_id" is null
        when 'expense' then "sales_invoice_lines"."waybill_expense_id" is not null
        else "sales_invoice_lines"."waybill_id" is null and "sales_invoice_lines"."waybill_expense_id" is null
      end);