CREATE TABLE "equipment_loan" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text NOT NULL,
	"member_id" text NOT NULL,
	"out_at" timestamp with time zone DEFAULT now() NOT NULL,
	"returned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructor_qual" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"class_type_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loanable_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_nps" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"score" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_type" ADD COLUMN "min_level_id" text;--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "min_level_id" text;--> statement-breakpoint
ALTER TABLE "gym_event" ADD COLUMN "min_level_id" text;--> statement-breakpoint
ALTER TABLE "equipment_loan" ADD CONSTRAINT "equipment_loan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_loan" ADD CONSTRAINT "equipment_loan_item_id_loanable_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."loanable_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_loan" ADD CONSTRAINT "equipment_loan_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_qual" ADD CONSTRAINT "instructor_qual_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_qual" ADD CONSTRAINT "instructor_qual_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_qual" ADD CONSTRAINT "instructor_qual_class_type_id_class_type_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loanable_item" ADD CONSTRAINT "loanable_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_nps" ADD CONSTRAINT "member_nps_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_nps" ADD CONSTRAINT "member_nps_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_loan_org_idx" ON "equipment_loan" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "instructor_qual_org_idx" ON "instructor_qual" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "loanable_item_org_idx" ON "loanable_item" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_nps_org_idx" ON "member_nps" USING btree ("organization_id");