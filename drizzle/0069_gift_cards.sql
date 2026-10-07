ALTER TYPE "public"."payment_method" ADD VALUE 'gift_card';--> statement-breakpoint
CREATE TABLE "gift_card" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"amount" integer NOT NULL,
	"balance" integer NOT NULL,
	"purchaser_member_id" text,
	"redeemed_by_member_id" text,
	"redeemed_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gift_card" ADD CONSTRAINT "gift_card_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card" ADD CONSTRAINT "gift_card_purchaser_member_id_gym_member_id_fk" FOREIGN KEY ("purchaser_member_id") REFERENCES "public"."gym_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card" ADD CONSTRAINT "gift_card_redeemed_by_member_id_gym_member_id_fk" FOREIGN KEY ("redeemed_by_member_id") REFERENCES "public"."gym_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gift_card_org_code_idx" ON "gift_card" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "gift_card_org_idx" ON "gift_card" USING btree ("organization_id");