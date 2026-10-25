CREATE TABLE "party_contacts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "party_contacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"party_id" bigint NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"mobile" varchar(20),
	"email" varchar(120),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party_contacts" ADD CONSTRAINT "party_contacts_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "party_contacts_party_idx" ON "party_contacts" USING btree ("party_id");--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_row ON party_contacts;--> statement-breakpoint
CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON party_contacts FOR EACH ROW EXECUTE FUNCTION audit_row();
