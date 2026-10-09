ALTER TABLE "gym_settings" ADD COLUMN "birthday_comp_credits" integer;--> statement-breakpoint
ALTER TABLE "gym_settings" ADD COLUMN "self_freeze_days" integer;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "self_freeze_used_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN "self_freeze_year" integer;