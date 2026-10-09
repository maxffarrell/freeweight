CREATE TABLE "announcement_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"tag" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_level" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gym_member" ADD COLUMN "skill_level_id" text;--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "late_cancel_freebies" integer;--> statement-breakpoint
ALTER TABLE "announcement_template" ADD CONSTRAINT "announcement_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_template" ADD CONSTRAINT "announcement_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_level" ADD CONSTRAINT "member_level_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_template_org_idx" ON "announcement_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_level_org_idx" ON "member_level" USING btree ("organization_id");