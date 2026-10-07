CREATE TYPE "public"."resource_booking_status" AS ENUM('booked', 'cancelled');--> statement-breakpoint
CREATE TABLE "facility_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"slot_min" integer DEFAULT 30 NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"open_from" text DEFAULT '06:00' NOT NULL,
	"open_to" text DEFAULT '22:00' NOT NULL,
	"location_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_booking" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"member_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "resource_booking_status" DEFAULT 'booked' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facility_resource" ADD CONSTRAINT "facility_resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_resource" ADD CONSTRAINT "facility_resource_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_resource_id_facility_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."facility_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_booking" ADD CONSTRAINT "resource_booking_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facility_resource_org_idx" ON "facility_resource" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "resource_booking_resource_idx" ON "resource_booking" USING btree ("resource_id","starts_at");--> statement-breakpoint
CREATE INDEX "resource_booking_member_idx" ON "resource_booking" USING btree ("member_id");