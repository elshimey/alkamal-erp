CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"user_id" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"app" varchar(10) NOT NULL,
	"endpoint" text NOT NULL UNIQUE,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id", "app");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "office_notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"kind" varchar(30) NOT NULL,
	"text" text NOT NULL,
	"href" text NOT NULL,
	"entity" varchar(40) NOT NULL,
	"action" varchar(20) NOT NULL,
	"driver_id" bigint REFERENCES "drivers"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "office_notifications_created_idx" ON "office_notifications" ("created_at");
