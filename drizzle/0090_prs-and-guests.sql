CREATE TABLE "personal_record" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"recorded_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "guest_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_record" ADD CONSTRAINT "personal_record_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_record_member_idx" ON "personal_record" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "personal_record_org_idx" ON "personal_record" USING btree ("organization_id");