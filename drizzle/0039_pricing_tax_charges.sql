-- التسعير والضرائب ومصاريف العميل (2026-11-18)
-- 1) أنواع الضريبة بأسماء وافق وسلوكها
ALTER TABLE "public"."tax_codes" ADD COLUMN IF NOT EXISTS "behavior" varchar(20) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."tax_codes" ADD COLUMN IF NOT EXISTS "side" varchar(10) DEFAULT 'sales' NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."tax_codes" ADD COLUMN IF NOT EXISTS "category" varchar(1);--> statement-breakpoint
ALTER TABLE "public"."tax_codes" ADD COLUMN IF NOT EXISTS "exemption_code" varchar(30);--> statement-breakpoint
ALTER TABLE "public"."tax_codes" ADD COLUMN IF NOT EXISTS "exemption_reason" text;--> statement-breakpoint
ALTER TABLE "public"."tax_codes" ADD COLUMN IF NOT EXISTS "sort" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
INSERT INTO "public"."tax_codes" ("code", "name_ar", "kind", "rate", "account_id", "behavior", "side", "category", "exemption_code", "exemption_reason", "sort")
  VALUES ('VAT15-OUT', 'ضريبة القيمة المضافة على الإيرادات', 'output', '15', (select id from "public"."accounts" where code = '2109'), 'standard', 'sales', 'S', NULL, NULL, 1)
  ON CONFLICT ("code") DO UPDATE SET "name_ar" = excluded."name_ar", "behavior" = excluded."behavior", "side" = excluded."side", "category" = excluded."category",
    "exemption_code" = excluded."exemption_code", "exemption_reason" = excluded."exemption_reason", "sort" = excluded."sort", "kind" = excluded."kind";--> statement-breakpoint
INSERT INTO "public"."tax_codes" ("code", "name_ar", "kind", "rate", "account_id", "behavior", "side", "category", "exemption_code", "exemption_reason", "sort")
  VALUES ('ZERO', 'توريدات داخل المملكة خاضعة للضريبة بنسبة صفر', 'zero_rated', '0', (select id from "public"."accounts" where code = '2109'), 'zero', 'sales', 'Z', 'VATEX-SA-34-1', 'The international transport of Goods', 2)
  ON CONFLICT ("code") DO UPDATE SET "name_ar" = excluded."name_ar", "behavior" = excluded."behavior", "side" = excluded."side", "category" = excluded."category",
    "exemption_code" = excluded."exemption_code", "exemption_reason" = excluded."exemption_reason", "sort" = excluded."sort", "kind" = excluded."kind";--> statement-breakpoint
INSERT INTO "public"."tax_codes" ("code", "name_ar", "kind", "rate", "account_id", "behavior", "side", "category", "exemption_code", "exemption_reason", "sort")
  VALUES ('EXPORT', 'صادرات', 'zero_rated', '0', (select id from "public"."accounts" where code = '2109'), 'export', 'sales', 'Z', 'VATEX-SA-33', 'Export of services', 3)
  ON CONFLICT ("code") DO UPDATE SET "name_ar" = excluded."name_ar", "behavior" = excluded."behavior", "side" = excluded."side", "category" = excluded."category",
    "exemption_code" = excluded."exemption_code", "exemption_reason" = excluded."exemption_reason", "sort" = excluded."sort", "kind" = excluded."kind";--> statement-breakpoint
INSERT INTO "public"."tax_codes" ("code", "name_ar", "kind", "rate", "account_id", "behavior", "side", "category", "exemption_code", "exemption_reason", "sort")
  VALUES ('EXEMPT', 'معفى', 'exempt', '0', NULL, 'exempt', 'sales', 'E', 'VATEX-SA-29', 'Financial services mentioned in Article 29 of the VAT Regulations', 4)
  ON CONFLICT ("code") DO UPDATE SET "name_ar" = excluded."name_ar", "behavior" = excluded."behavior", "side" = excluded."side", "category" = excluded."category",
    "exemption_code" = excluded."exemption_code", "exemption_reason" = excluded."exemption_reason", "sort" = excluded."sort", "kind" = excluded."kind";--> statement-breakpoint
INSERT INTO "public"."tax_codes" ("code", "name_ar", "kind", "rate", "account_id", "behavior", "side", "category", "exemption_code", "exemption_reason", "sort")
  VALUES ('OOS', 'غير خاضع للضريبة', 'exempt', '0', NULL, 'out_of_scope', 'both', 'O', 'VATEX-SA-OOS', 'Not subject to VAT', 5)
  ON CONFLICT ("code") DO UPDATE SET "name_ar" = excluded."name_ar", "behavior" = excluded."behavior", "side" = excluded."side", "category" = excluded."category",
    "exemption_code" = excluded."exemption_code", "exemption_reason" = excluded."exemption_reason", "sort" = excluded."sort", "kind" = excluded."kind";--> statement-breakpoint
INSERT INTO "public"."tax_codes" ("code", "name_ar", "kind", "rate", "account_id", "behavior", "side", "category", "exemption_code", "exemption_reason", "sort")
  VALUES ('VAT15-IN', 'ضريبة القيمة المضافة على مشتريات', 'input', '15', (select id from "public"."accounts" where code = '1108'), 'pur_standard', 'purchases', NULL, NULL, NULL, 6)
  ON CONFLICT ("code") DO UPDATE SET "name_ar" = excluded."name_ar", "behavior" = excluded."behavior", "side" = excluded."side", "category" = excluded."category",
    "exemption_code" = excluded."exemption_code", "exemption_reason" = excluded."exemption_reason", "sort" = excluded."sort", "kind" = excluded."kind";--> statement-breakpoint
INSERT INTO "public"."tax_codes" ("code", "name_ar", "kind", "rate", "account_id", "behavior", "side", "category", "exemption_code", "exemption_reason", "sort")
  VALUES ('VAT-CUSTOMS', 'ضريبة القيمة المضافة في الجمارك', 'input', '15', (select id from "public"."accounts" where code = '1108'), 'customs', 'purchases', NULL, NULL, NULL, 7)
  ON CONFLICT ("code") DO UPDATE SET "name_ar" = excluded."name_ar", "behavior" = excluded."behavior", "side" = excluded."side", "category" = excluded."category",
    "exemption_code" = excluded."exemption_code", "exemption_reason" = excluded."exemption_reason", "sort" = excluded."sort", "kind" = excluded."kind";--> statement-breakpoint
INSERT INTO "public"."tax_codes" ("code", "name_ar", "kind", "rate", "account_id", "behavior", "side", "category", "exemption_code", "exemption_reason", "sort")
  VALUES ('REVERSE', 'إحتساب عكسي', 'input', '15', (select id from "public"."accounts" where code = '1108'), 'reverse', 'purchases', NULL, NULL, NULL, 8)
  ON CONFLICT ("code") DO UPDATE SET "name_ar" = excluded."name_ar", "behavior" = excluded."behavior", "side" = excluded."side", "category" = excluded."category",
    "exemption_code" = excluded."exemption_code", "exemption_reason" = excluded."exemption_reason", "sort" = excluded."sort", "kind" = excluded."kind";--> statement-breakpoint
INSERT INTO "public"."tax_codes" ("code", "name_ar", "kind", "rate", "account_id", "behavior", "side", "category", "exemption_code", "exemption_reason", "sort")
  VALUES ('PUR-ZERO', 'مشتريات بنسبة صفر', 'zero_rated', '0', NULL, 'pur_zero', 'purchases', NULL, NULL, NULL, 9)
  ON CONFLICT ("code") DO UPDATE SET "name_ar" = excluded."name_ar", "behavior" = excluded."behavior", "side" = excluded."side", "category" = excluded."category",
    "exemption_code" = excluded."exemption_code", "exemption_reason" = excluded."exemption_reason", "sort" = excluded."sort", "kind" = excluded."kind";--> statement-breakpoint
INSERT INTO "public"."tax_codes" ("code", "name_ar", "kind", "rate", "account_id", "behavior", "side", "category", "exemption_code", "exemption_reason", "sort")
  VALUES ('PUR-EXEMPT', 'مشتريات معفاة من الضريبة', 'exempt', '0', NULL, 'pur_exempt', 'purchases', NULL, NULL, NULL, 10)
  ON CONFLICT ("code") DO UPDATE SET "name_ar" = excluded."name_ar", "behavior" = excluded."behavior", "side" = excluded."side", "category" = excluded."category",
    "exemption_code" = excluded."exemption_code", "exemption_reason" = excluded."exemption_reason", "sort" = excluded."sort", "kind" = excluded."kind";--> statement-breakpoint
-- 2) مصروفات مستردة من العملاء (ذمة، لا مصروف ولا إيراد)
INSERT INTO "public"."accounts" ("code", "name_ar", "parent_id", "level", "type", "normal_balance", "is_postable", "requires_cost_center", "note", "is_system")
  SELECT '1114', 'مصاريف مستردة من العملاء غير مفوترة', p.id, 3, 'asset', 'debit', true, false, 'ما دُفع نيابة عن العميل حتى يُفوتر عليه', true
  FROM "public"."accounts" p WHERE p.code = '11'
  ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- 3) مكونات سعر الشحنة
ALTER TABLE "public"."waybills" ADD COLUMN IF NOT EXISTS "base_amount" numeric(18, 3);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."waybill_price_components" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"waybill_id" bigint NOT NULL REFERENCES "public"."waybills"("id") ON DELETE CASCADE,
	"line_no" smallint NOT NULL,
	"kind" varchar(30) NOT NULL,
	"class_id" bigint REFERENCES "public"."lookup_values"("id"),
	"label" text NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '1' NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"amount" numeric(18, 3) NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waybill_price_components_waybill_idx" ON "public"."waybill_price_components" ("waybill_id");--> statement-breakpoint
-- 4) مصاريف العميل: الدفع من الصندوق، والقيد المستقل، ومصروف السائق المصدر
ALTER TYPE "public"."expense_payer" ADD VALUE IF NOT EXISTS 'cash';--> statement-breakpoint
ALTER TABLE "public"."waybill_expenses" ADD COLUMN IF NOT EXISTS "cash_account_id" bigint REFERENCES "public"."accounts"("id");--> statement-breakpoint
ALTER TABLE "public"."waybill_expenses" ADD COLUMN IF NOT EXISTS "journal_entry_id" bigint REFERENCES "public"."journal_entries"("id");--> statement-breakpoint
ALTER TABLE "public"."waybill_expenses" ADD COLUMN IF NOT EXISTS "source_expense_id" bigint REFERENCES "public"."expenses"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waybill_expenses_source_uq" ON "public"."waybill_expenses" ("source_expense_id") WHERE "source_expense_id" is not null;--> statement-breakpoint
ALTER TABLE "public"."waybill_expenses" ADD CONSTRAINT "waybill_expenses_cash" CHECK ("payer"::text <> 'cash' or "cash_account_id" is not null);--> statement-breakpoint
ALTER TABLE "public"."expenses" ADD COLUMN IF NOT EXISTS "bill_to_customer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."charge_types" ADD COLUMN IF NOT EXISTS "on_behalf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- 5) الفاتورة: تفاصيل السطر وتكلفة المصروف المسترد، وضريبة سطر الإشعار
ALTER TABLE "public"."sales_invoice_lines" ADD COLUMN IF NOT EXISTS "details" text;--> statement-breakpoint
ALTER TABLE "public"."sales_invoice_lines" ADD COLUMN IF NOT EXISTS "cost_amount" numeric(18, 3);--> statement-breakpoint
ALTER TABLE "public"."adjustment_note_lines" ADD COLUMN IF NOT EXISTS "tax_code_id" bigint REFERENCES "public"."tax_codes"("id");--> statement-breakpoint
UPDATE "public"."adjustment_note_lines" l SET "tax_code_id" = t.id FROM "public"."adjustment_notes" n, "public"."tax_codes" t
  WHERE n.id = l.note_id AND l.tax_code_id IS NULL
    AND t.code = CASE WHEN l.vat_rate > 0 THEN (CASE WHEN n.kind::text LIKE 'sales%' THEN 'VAT15-OUT' ELSE 'VAT15-IN' END)
                      ELSE (CASE WHEN n.kind::text LIKE 'sales%' THEN 'ZERO' ELSE 'PUR-ZERO' END) END;
