ALTER TABLE "fleet_documents" ALTER COLUMN "document_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_documents" DROP COLUMN "type";--> statement-breakpoint
DROP TYPE "public"."fleet_document_type";