-- تنبيه انتهاء الوثائق اليومي: مراحل الإشعار المرسلة لكل وثيقة، ومهام اليوم الواحد
CREATE TABLE IF NOT EXISTS "document_alert_sends" (
	"document_id" bigint NOT NULL REFERENCES "fleet_documents"("id") ON DELETE cascade,
	"stage" varchar(12) NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_alert_sends_document_id_stage_pk" PRIMARY KEY("document_id","stage")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_jobs" (
	"job" varchar(40) PRIMARY KEY NOT NULL,
	"last_date" date NOT NULL
);
