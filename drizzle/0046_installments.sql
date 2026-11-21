-- جدول أقساط الدائنين (ملاحظة التشغيل 16، قرارات أحمد 2026-11-21): خطة سداد على حساب دائن موجود في الشجرة
-- (قرض بنكي 2114/2201، أقساط سيارات، دائن شخصي، مورد). القسط = أصل + تكلفة تمويل على 7101،
-- والتكلفة تُستحق يوم الاستحقاق، والسداد بسند صرف من نوع «سداد قسط».
ALTER TYPE "payment_kind" ADD VALUE IF NOT EXISTS 'installment';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installment_plans" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"name" varchar(120) NOT NULL,
	"account_id" bigint NOT NULL REFERENCES "accounts"("id"),
	"party_id" bigint REFERENCES "parties"("id"),
	"vehicle_id" bigint REFERENCES "vehicles"("id"),
	"notes" text,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"payoff_payment_id" bigint REFERENCES "payments"("id") ON DELETE SET NULL,
	"payoff_entry_id" bigint REFERENCES "journal_entries"("id") ON DELETE SET NULL,
	"payoff_date" date,
	"created_by" bigint REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_plans_status" CHECK ("status" in ('active', 'settled'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"plan_id" bigint NOT NULL REFERENCES "installment_plans"("id") ON DELETE cascade,
	"seq" integer NOT NULL,
	"due_date" date NOT NULL,
	"principal" numeric(18, 3) NOT NULL,
	"cost" numeric(18, 3) DEFAULT '0' NOT NULL,
	"cost_entry_id" bigint REFERENCES "journal_entries"("id") ON DELETE SET NULL,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installments_plan_seq" UNIQUE("plan_id", "seq"),
	CONSTRAINT "installments_amounts" CHECK ("principal" >= 0 and "cost" >= 0 and "principal" + "cost" > 0),
	CONSTRAINT "installments_status" CHECK ("status" in ('open', 'settled'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "installments_due_idx" ON "installments" ("status", "due_date");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installment_payments" (
	"payment_id" bigint PRIMARY KEY NOT NULL REFERENCES "payments"("id") ON DELETE cascade,
	"installment_id" bigint NOT NULL REFERENCES "installments"("id") ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "installment_payments_installment_idx" ON "installment_payments" ("installment_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installment_alert_sends" (
	"installment_id" bigint NOT NULL REFERENCES "installments"("id") ON DELETE cascade,
	"stage" varchar(12) NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_alert_sends_pk" PRIMARY KEY("installment_id", "stage")
);
