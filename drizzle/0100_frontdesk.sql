CREATE TABLE "locker" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"label" text NOT NULL,
	"member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_announcement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"tag" text,
	"plan_id" text,
	"weekday" integer NOT NULL,
	"time" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_sent_on" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "streak_reward_credits" integer;--> statement-breakpoint
ALTER TABLE "locker" ADD CONSTRAINT "locker_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locker" ADD CONSTRAINT "locker_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_announcement" ADD CONSTRAINT "recurring_announcement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_announcement" ADD CONSTRAINT "recurring_announcement_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locker_org_label_idx" ON "locker" USING btree ("organization_id","label");--> statement-breakpoint
CREATE INDEX "recurring_announcement_org_idx" ON "recurring_announcement" USING btree ("organization_id");