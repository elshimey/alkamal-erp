CREATE TYPE "public"."zatca_doc_status" AS ENUM('cleared', 'cleared_warnings', 'rejected', 'error');--> statement-breakpoint
CREATE TYPE "public"."zatca_env" AS ENUM('sandbox', 'simulation', 'production');--> statement-breakpoint
CREATE TABLE "zatca_documents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "zatca_documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sales_invoice_id" bigint,
	"note_id" bigint,
	"environment" "zatca_env" NOT NULL,
	"icv" integer NOT NULL,
	"uuid" uuid NOT NULL,
	"invoice_hash" text NOT NULL,
	"previous_hash" text NOT NULL,
	"xml" text NOT NULL,
	"cleared_xml" text,
	"qr" text,
	"status" "zatca_doc_status" NOT NULL,
	"http_status" integer,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zatca_documents_ref" CHECK (("zatca_documents"."sales_invoice_id" is null) <> ("zatca_documents"."note_id" is null))
);
--> statement-breakpoint
CREATE TABLE "zatca_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"environment" "zatca_env" DEFAULT 'simulation' NOT NULL,
	"egs_serial" varchar(120),
	"private_key" text,
	"csr" text,
	"compliance_request_id" varchar(60),
	"compliance_token" text,
	"compliance_secret" text,
	"token" text,
	"secret" text,
	"certificate" text,
	"certificate_expires_at" timestamp with time zone,
	"onboarded_at" timestamp with time zone,
	"auto_send" boolean DEFAULT true NOT NULL,
	"last_icv" integer DEFAULT 0 NOT NULL,
	"last_hash" text,
	"sandbox_test" jsonb,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zatca_settings_single" CHECK ("zatca_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "building_no" varchar(10);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "postal_code" varchar(10);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "additional_no" varchar(10);--> statement-breakpoint
ALTER TABLE "zatca_documents" ADD CONSTRAINT "zatca_documents_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zatca_documents" ADD CONSTRAINT "zatca_documents_note_id_adjustment_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."adjustment_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zatca_documents" ADD CONSTRAINT "zatca_documents_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zatca_settings" ADD CONSTRAINT "zatca_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zatca_documents_invoice_idx" ON "zatca_documents" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "zatca_documents_note_idx" ON "zatca_documents" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zatca_documents_icv_uq" ON "zatca_documents" USING btree ("environment","icv") WHERE "zatca_documents"."status" <> 'error';