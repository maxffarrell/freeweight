CREATE TABLE "challenge" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"goal" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenge_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"challenge_id" text NOT NULL,
	"member_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "challenge" ADD CONSTRAINT "challenge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_entry" ADD CONSTRAINT "challenge_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_entry" ADD CONSTRAINT "challenge_entry_challenge_id_challenge_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_entry" ADD CONSTRAINT "challenge_entry_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "challenge_org_idx" ON "challenge" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "challenge_entry_challenge_idx" ON "challenge_entry" USING btree ("challenge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_entry_member_key" ON "challenge_entry" USING btree ("challenge_id","member_id");