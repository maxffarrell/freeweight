CREATE TABLE "member_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_tag" ADD CONSTRAINT "member_tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tag" ADD CONSTRAINT "member_tag_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_tag_member_idx" ON "member_tag" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_tag_org_tag_idx" ON "member_tag" USING btree ("organization_id","tag");--> statement-breakpoint
CREATE UNIQUE INDEX "member_tag_unique" ON "member_tag" USING btree ("member_id","tag");