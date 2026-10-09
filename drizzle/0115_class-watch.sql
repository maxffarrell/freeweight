CREATE TABLE "class_watch" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"class_type_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_watch" ADD CONSTRAINT "class_watch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_watch" ADD CONSTRAINT "class_watch_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_watch" ADD CONSTRAINT "class_watch_class_type_id_class_type_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."class_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_watch_class_idx" ON "class_watch" USING btree ("class_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_watch_unique" ON "class_watch" USING btree ("member_id","class_type_id");