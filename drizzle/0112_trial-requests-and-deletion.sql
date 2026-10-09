CREATE TYPE "public"."trial_request_status" AS ENUM('pending', 'confirmed', 'declined');--> statement-breakpoint
CREATE TABLE "trial_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"member_id" text NOT NULL,
	"status" "trial_request_status" DEFAULT 'pending' NOT NULL,
	"booking_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gym_member" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trial_request" ADD CONSTRAINT "trial_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_request" ADD CONSTRAINT "trial_request_session_id_class_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_request" ADD CONSTRAINT "trial_request_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_request" ADD CONSTRAINT "trial_request_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trial_request_org_idx" ON "trial_request" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "trial_request_member_idx" ON "trial_request" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_request_open_idx" ON "trial_request" USING btree ("session_id","member_id") WHERE "trial_request"."status" != 'declined';