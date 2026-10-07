ALTER TABLE "gym_settings" ADD COLUMN "save_offer_pct" integer;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "save_offer_at" timestamp with time zone;