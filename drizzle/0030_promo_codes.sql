CREATE TABLE "promo_code" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"percent_off" integer,
	"amount_off" integer,
	"max_uses" integer,
	"times_used" integer DEFAULT 0 NOT NULL,
	"expires_at" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promo_code" ADD CONSTRAINT "promo_code_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_code_org_code_idx" ON "promo_code" USING btree ("organization_id","code");