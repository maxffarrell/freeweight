CREATE TABLE "recurring_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"next_due" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_charge" ADD CONSTRAINT "recurring_charge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_charge" ADD CONSTRAINT "recurring_charge_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_charge_org_due_idx" ON "recurring_charge" USING btree ("organization_id","next_due");--> statement-breakpoint
CREATE INDEX "recurring_charge_member_idx" ON "recurring_charge" USING btree ("member_id");