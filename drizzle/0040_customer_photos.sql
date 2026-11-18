ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "hidden_from_customer" boolean DEFAULT false NOT NULL;
