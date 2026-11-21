-- المصروفات غير المسددة (خطة التقارير والمصروفات 2026-11-21، الخطوة 2):
-- «لم يُدفع بعد» دافعاً لمصاريف العميل والمصروفات المباشرة؛ يُعتمد من «سندات صرف تحت المراجعة»
-- فيُقيد التزاماً على المورد المستفيد أو 2106، ثم يُسدد بسند صرف من نوع «مصروف مستحق».
ALTER TYPE "expense_payer" ADD VALUE IF NOT EXISTS 'unpaid';--> statement-breakpoint
ALTER TYPE "direct_expense_payer" ADD VALUE IF NOT EXISTS 'unpaid';--> statement-breakpoint
ALTER TYPE "payment_kind" ADD VALUE IF NOT EXISTS 'expense';--> statement-breakpoint
ALTER TABLE "waybill_expenses" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waybill_expenses" ADD COLUMN IF NOT EXISTS "approved_by" bigint REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "waybill_expenses" ADD COLUMN IF NOT EXISTS "payment_id" bigint REFERENCES "payments"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "party_id" bigint REFERENCES "parties"("id");--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "payment_id" bigint REFERENCES "payments"("id") ON DELETE SET NULL;
