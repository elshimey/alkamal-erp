CREATE TABLE "invoice_template" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_template_single" CHECK ("invoice_template"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "invoice_template" ADD CONSTRAINT "invoice_template_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;