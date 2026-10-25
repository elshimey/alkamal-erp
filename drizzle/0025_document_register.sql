CREATE TYPE "public"."document_blocking" AS ENUM('block', 'international', 'alert');--> statement-breakpoint
CREATE TYPE "public"."document_owner_kind" AS ENUM('vehicle', 'trailer', 'driver', 'employee', 'company', 'customer');--> statement-breakpoint
CREATE TYPE "public"."vehicle_asset_kind" AS ENUM('head', 'trailer');--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" varchar(40) NOT NULL,
	"name_ar" text NOT NULL,
	"owner_kind" "document_owner_kind" NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"blocking" "document_blocking" DEFAULT 'alert' NOT NULL,
	"alert_days" varchar(40) DEFAULT '60,30,7' NOT NULL,
	"authority" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "document_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "fleet_documents" DROP CONSTRAINT "fleet_documents_one_owner";--> statement-breakpoint
ALTER TABLE "fleet_documents" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_documents" ALTER COLUMN "expiry_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD COLUMN "document_type_id" bigint;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD COLUMN "employee_id" bigint;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD COLUMN "party_id" bigint;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD COLUMN "created_by" bigint;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "asset_kind" "vehicle_asset_kind" DEFAULT 'head' NOT NULL;--> statement-breakpoint
ALTER TABLE "waybills" ADD COLUMN "trailer_id" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_owner_name" ON "document_types" USING btree ("owner_kind","name_ar");--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_trailer_id_vehicles_id_fk" FOREIGN KEY ("trailer_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_documents_type_idx" ON "fleet_documents" USING btree ("document_type_id");--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_one_owner" CHECK (num_nonnulls("fleet_documents"."vehicle_id", "fleet_documents"."driver_id", "fleet_documents"."employee_id", "fleet_documents"."party_id") <= 1);--> statement-breakpoint
INSERT INTO "document_types" ("code", "name_ar", "owner_kind", "required", "blocking", "authority", "sort_order") VALUES
('v_registration', 'رخصة السير (الاستمارة)', 'vehicle', true, 'block', 'المرور', 1),
('v_inspection', 'الفحص الفني الدوري', 'vehicle', true, 'block', 'الفحص الدوري', 2),
('v_operating_card', 'كرت التشغيل', 'vehicle', true, 'block', 'هيئة النقل', 3),
('v_insurance', 'التأمين الإلزامي', 'vehicle', true, 'block', 'شركة التأمين', 4),
('v_authorization', 'تفويض القيادة', 'vehicle', true, 'block', 'أبشر', 5),
('v_tracking', 'جهاز التتبع واشتراكه', 'vehicle', true, 'block', NULL, 6),
('v_gcc_insurance', 'التأمين الخليجي (البرتقالي)', 'vehicle', false, 'international', 'شركة التأمين', 7),
('v_customs_card', 'البطاقة الجمركية', 'vehicle', false, 'international', 'الجمارك', 8),
('v_lease', 'عقد الإيجار', 'vehicle', false, 'block', NULL, 9),
('v_finance', 'عقد التمويل / الرهن', 'vehicle', false, 'alert', NULL, 10),
('v_maintenance', 'صيانة دورية بالمدة', 'vehicle', false, 'alert', NULL, 11),
('v_other', 'أخرى', 'vehicle', false, 'alert', NULL, 12),
('t_registration', 'رخصة السير', 'trailer', true, 'block', 'المرور', 13),
('t_inspection', 'الفحص الفني', 'trailer', true, 'block', 'الفحص الدوري', 14),
('t_insurance', 'التأمين', 'trailer', true, 'block', 'شركة التأمين', 15),
('t_gcc_insurance', 'التأمين الخليجي', 'trailer', false, 'international', 'شركة التأمين', 16),
('t_other', 'أخرى', 'trailer', false, 'alert', NULL, 17),
('d_residency', 'الإقامة / الهوية', 'driver', true, 'block', 'الجوازات', 18),
('d_license', 'رخصة القيادة (نقل ثقيل)', 'driver', true, 'block', 'المرور', 19),
('d_professional_card', 'بطاقة السائق المهني', 'driver', true, 'block', 'هيئة النقل', 20),
('d_medical', 'الفحص الطبي والمخدرات', 'driver', true, 'block', NULL, 21),
('d_medical_insurance', 'التأمين الطبي', 'driver', true, 'alert', 'شركة التأمين', 22),
('d_work_permit', 'رخصة العمل', 'driver', false, 'alert', 'وزارة الموارد البشرية', 23),
('d_passport', 'جواز السفر', 'driver', false, 'international', NULL, 24),
('d_exit_reentry', 'تأشيرة خروج وعودة', 'driver', false, 'international', 'الجوازات', 25),
('d_kuwait_visa', 'تأشيرة الكويت', 'driver', false, 'international', NULL, 26),
('d_contract', 'عقد العمل', 'driver', true, 'alert', NULL, 27),
('d_other', 'أخرى', 'driver', false, 'alert', NULL, 28),
('e_residency', 'الإقامة / الهوية', 'employee', true, 'alert', 'الجوازات', 29),
('e_passport', 'جواز السفر', 'employee', false, 'alert', NULL, 30),
('e_work_permit', 'رخصة العمل', 'employee', false, 'alert', 'وزارة الموارد البشرية', 31),
('e_medical_insurance', 'التأمين الطبي', 'employee', true, 'alert', 'شركة التأمين', 32),
('e_exit_reentry', 'تأشيرة خروج وعودة', 'employee', false, 'alert', 'الجوازات', 33),
('e_contract', 'عقد العمل', 'employee', true, 'alert', NULL, 34),
('e_probation', 'فترة التجربة', 'employee', false, 'alert', NULL, 35),
('e_other', 'أخرى', 'employee', false, 'alert', NULL, 36),
('c_cr', 'السجل التجاري', 'company', true, 'alert', 'وزارة التجارة', 37),
('c_transport_license', 'ترخيص هيئة النقل', 'company', true, 'alert', 'هيئة النقل', 38),
('c_municipal', 'رخصة البلدية', 'company', true, 'alert', 'البلدية', 39),
('c_chamber', 'اشتراك الغرفة التجارية', 'company', true, 'alert', 'الغرفة التجارية', 40),
('c_zakat', 'شهادة الزكاة', 'company', true, 'alert', 'هيئة الزكاة والضريبة والجمارك', 41),
('c_gosi', 'شهادة التأمينات', 'company', true, 'alert', 'التأمينات الاجتماعية', 42),
('c_nitaqat', 'شهادة نطاقات', 'company', true, 'alert', 'وزارة الموارد البشرية', 43),
('c_national_address', 'العنوان الوطني', 'company', true, 'alert', 'سبل', 44),
('c_office_lease', 'عقد إيجار المقر', 'company', true, 'alert', NULL, 45),
('c_cargo_insurance', 'تأمين البضائع والمسؤولية', 'company', true, 'alert', 'شركة التأمين', 46),
('c_other', 'أخرى', 'company', false, 'alert', NULL, 47),
('k_cr', 'السجل التجاري', 'customer', false, 'block', 'وزارة التجارة', 48),
('k_vat', 'الشهادة الضريبية', 'customer', false, 'block', 'هيئة الزكاة والضريبة والجمارك', 49),
('k_national_address', 'العنوان الوطني', 'customer', false, 'alert', 'سبل', 50),
('k_contract', 'العقد', 'customer', false, 'block', NULL, 51),
('k_other', 'أخرى', 'customer', false, 'alert', NULL, 52);--> statement-breakpoint
UPDATE "fleet_documents" f SET "document_type_id" = (SELECT "id" FROM "document_types" WHERE "code" = CASE
  WHEN f."vehicle_id" IS NOT NULL THEN CASE f."type"::text WHEN 'registration' THEN 'v_registration' WHEN 'periodic_inspection' THEN 'v_inspection'
    WHEN 'operating_card' THEN 'v_operating_card' WHEN 'insurance' THEN 'v_insurance' WHEN 'authorization' THEN 'v_authorization' ELSE 'v_other' END
  ELSE CASE f."type"::text WHEN 'license' THEN 'd_license' WHEN 'residency' THEN 'd_residency' WHEN 'insurance' THEN 'd_medical_insurance' ELSE 'd_other' END
END);--> statement-breakpoint
CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON "document_types" FOR EACH ROW EXECUTE FUNCTION audit_row();