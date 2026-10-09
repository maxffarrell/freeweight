CREATE TABLE "member_issue" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_type" ADD COLUMN "bring_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_issue" ADD CONSTRAINT "member_issue_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_issue" ADD CONSTRAINT "member_issue_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_issue_member_idx" ON "member_issue" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_issue_org_idx" ON "member_issue" USING btree ("organization_id");