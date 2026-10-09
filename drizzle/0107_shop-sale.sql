CREATE TABLE "shop_sale" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text NOT NULL,
	"member_id" text NOT NULL,
	"charge_id" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"picked_up_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "booking_comp_idx";--> statement-breakpoint
ALTER TABLE "shop_sale" ADD CONSTRAINT "shop_sale_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_sale" ADD CONSTRAINT "shop_sale_item_id_shop_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_sale" ADD CONSTRAINT "shop_sale_member_id_gym_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."gym_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_sale" ADD CONSTRAINT "shop_sale_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_sale_org_idx" ON "shop_sale" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "shop_sale_member_idx" ON "shop_sale" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_comp_idx" ON "booking" USING btree ("comp_booking_id") WHERE "booking"."comp_booking_id" is not null and "booking"."status" != 'cancelled';