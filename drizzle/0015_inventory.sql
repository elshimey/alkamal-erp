CREATE TYPE "public"."product_kind" AS ENUM('stock', 'service');--> statement-breakpoint
CREATE TYPE "public"."stock_doc_kind" AS ENUM('adjustment', 'transfer', 'count');--> statement-breakpoint
CREATE TYPE "public"."stock_doc_status" AS ENUM('draft', 'posted');--> statement-breakpoint
CREATE TABLE "products" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" varchar(40) NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"kind" "product_kind" DEFAULT 'stock' NOT NULL,
	"category" text,
	"unit" varchar(20) DEFAULT 'حبة' NOT NULL,
	"barcode" varchar(60),
	"purchase_price" numeric(18, 3) DEFAULT '0' NOT NULL,
	"sale_price" numeric(18, 3) DEFAULT '0' NOT NULL,
	"reorder_level" numeric(12, 3) DEFAULT '0' NOT NULL,
	"account_id" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_code_unique" UNIQUE("code"),
	CONSTRAINT "products_prices" CHECK ("products"."purchase_price" >= 0 and "products"."sale_price" >= 0 and "products"."reorder_level" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_doc_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_doc_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"doc_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"system_qty" numeric(12, 3),
	"counted_qty" numeric(12, 3),
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_docs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_docs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"number" varchar(30) NOT NULL,
	"kind" "stock_doc_kind" NOT NULL,
	"doc_date" date NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"to_warehouse_id" bigint,
	"offset_account_id" bigint,
	"cost_center_id" bigint,
	"reason" text,
	"status" "stock_doc_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" bigint,
	"created_by" bigint,
	"posted_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_docs_number_unique" UNIQUE("number"),
	CONSTRAINT "stock_docs_transfer" CHECK (("stock_docs"."kind" = 'transfer') = ("stock_docs"."to_warehouse_id" is not null) and ("stock_docs"."to_warehouse_id" is null or "stock_docs"."to_warehouse_id" <> "stock_docs"."warehouse_id"))
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_moves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"move_date" date NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"value" numeric(18, 3) NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"source_id" bigint NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_moves_qty" CHECK ("stock_moves"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "warehouses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" varchar(20) NOT NULL,
	"name_ar" text NOT NULL,
	"location" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "maintenance_lines" ADD COLUMN "product_id" bigint;--> statement-breakpoint
ALTER TABLE "maintenance_lines" ADD COLUMN "warehouse_id" bigint;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "product_id" bigint;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "warehouse_id" bigint;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD COLUMN "quantity" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_doc_lines" ADD CONSTRAINT "stock_doc_lines_doc_id_stock_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."stock_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_doc_lines" ADD CONSTRAINT "stock_doc_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_offset_account_id_accounts_id_fk" FOREIGN KEY ("offset_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_name_idx" ON "products" USING btree ("name_ar");--> statement-breakpoint
CREATE INDEX "stock_doc_lines_doc_idx" ON "stock_doc_lines" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "stock_docs_date_idx" ON "stock_docs" USING btree ("doc_date");--> statement-breakpoint
CREATE INDEX "stock_moves_product_idx" ON "stock_moves" USING btree ("product_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_moves_source_idx" ON "stock_moves" USING btree ("source_type","source_id");--> statement-breakpoint
ALTER TABLE "maintenance_lines" ADD CONSTRAINT "maintenance_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_lines" ADD CONSTRAINT "maintenance_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "warehouses" ("code", "name_ar") VALUES ('WH-01', 'المستودع الرئيسي');
