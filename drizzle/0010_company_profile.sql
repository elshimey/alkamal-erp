CREATE TABLE "company_profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"vat_number" varchar(15),
	"cr_number" varchar(20),
	"building_no" varchar(10),
	"street" text,
	"district" text,
	"city" text,
	"postal_code" varchar(10),
	"additional_no" varchar(10),
	"country" varchar(2) DEFAULT 'SA' NOT NULL,
	"phone" varchar(30),
	"email" varchar(120),
	"website" varchar(120),
	"logo" text,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_profile_single" CHECK ("company_profile"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "company_profile" ADD CONSTRAINT "company_profile_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;