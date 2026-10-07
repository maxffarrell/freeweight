CREATE TABLE "member_measurement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" real NOT NULL,
	"unit" text NOT NULL,
	"recorded_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_measurement" ADD CONSTRAINT "member_measurement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_measurement" ADD CONSTRAINT "member_measurement_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_measurement_member_idx" ON "member_measurement" USING btree ("member_id","recorded_at");