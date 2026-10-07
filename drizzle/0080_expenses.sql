CREATE TABLE "expense" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"label" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"amount_cents" integer NOT NULL,
	"expense_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_org_date_idx" ON "expense" USING btree ("organization_id","expense_on");