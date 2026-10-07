CREATE TABLE "instructor_time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"instructor_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instructor_time_off" ADD CONSTRAINT "instructor_time_off_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_time_off" ADD CONSTRAINT "instructor_time_off_instructor_id_member_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instructor_time_off_member_idx" ON "instructor_time_off" USING btree ("instructor_id");