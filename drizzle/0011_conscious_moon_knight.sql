CREATE TABLE "class_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"class_type_id" text NOT NULL,
	"location_id" text,
	"instructor_id" text,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"capacity" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_session" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "class_template" ADD CONSTRAINT "class_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_template" ADD CONSTRAINT "class_template_class_type_id_class_type_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_template" ADD CONSTRAINT "class_template_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_template" ADD CONSTRAINT "class_template_instructor_id_member_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_template_org_idx" ON "class_template" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_template_id_class_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."class_template"("id") ON DELETE set null ON UPDATE no action;