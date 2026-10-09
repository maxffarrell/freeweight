CREATE TABLE "recurring_expense" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"label" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"amount_cents" integer NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"next_due" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_session" ADD COLUMN "stream_url" text;--> statement-breakpoint
ALTER TABLE "class_type" ADD COLUMN "default_stream_url" text;--> statement-breakpoint
ALTER TABLE "recurring_expense" ADD CONSTRAINT "recurring_expense_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_expense_org_due_idx" ON "recurring_expense" USING btree ("organization_id","next_due");