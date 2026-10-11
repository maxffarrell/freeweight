CREATE TABLE "member_field" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"options" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_field_value" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"field_id" text NOT NULL,
	"member_id" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_field" ADD CONSTRAINT "member_field_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_field_value" ADD CONSTRAINT "member_field_value_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_field_value" ADD CONSTRAINT "member_field_value_field_id_member_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."member_field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_field_value" ADD CONSTRAINT "member_field_value_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_field_org_idx" ON "member_field" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_field_value_field_member_idx" ON "member_field_value" USING btree ("field_id","member_id");--> statement-breakpoint
CREATE INDEX "member_field_value_member_idx" ON "member_field_value" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_field_value_org_idx" ON "member_field_value" USING btree ("organization_id");